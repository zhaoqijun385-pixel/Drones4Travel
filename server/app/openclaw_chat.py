"""Authenticated persistence for OpenClaw conversation indexes and transcripts."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_async_session
from .models import OpenClawConversation, OpenClawMessage, User
from .schemas import OpenClawConversationCreate, OpenClawMessageCreate
from .users import current_active_user

router = APIRouter(tags=["openclaw-chat"])


def conversation_json(row: OpenClawConversation) -> dict:
    return {
        "id": str(row.id),
        "agent_id": row.agent_id,
        "session_key": row.session_key,
        "title": row.title,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def message_json(row: OpenClawMessage) -> dict:
    return {
        "id": str(row.id),
        "role": row.role,
        "content": row.content,
        "external_id": row.external_id,
        "created_at": row.created_at,
    }


async def owned_conversation(
    conversation_id: uuid.UUID,
    user: User,
    session: AsyncSession,
) -> OpenClawConversation:
    row = (
        await session.execute(
            select(OpenClawConversation).where(
                OpenClawConversation.id == conversation_id,
                OpenClawConversation.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="conversation_not_found")
    return row


@router.get("/openclaw/conversations")
async def list_conversations(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> list[dict]:
    rows = (
        await session.execute(
            select(OpenClawConversation)
            .where(OpenClawConversation.user_id == user.id)
            .order_by(desc(OpenClawConversation.updated_at))
            .limit(100)
        )
    ).scalars().all()
    return [conversation_json(row) for row in rows]


@router.post("/openclaw/conversations")
async def ensure_conversation(
    data: OpenClawConversationCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    query = select(OpenClawConversation).where(
        OpenClawConversation.user_id == user.id,
        OpenClawConversation.session_key == data.session_key,
    )
    row = (await session.execute(query)).scalar_one_or_none()
    if row is None:
        row = OpenClawConversation(
            user_id=user.id,
            agent_id=data.agent_id,
            session_key=data.session_key,
            title=data.title,
        )
        session.add(row)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            row = (await session.execute(query)).scalar_one()
    elif data.title and row.title != data.title:
        row.title = data.title
        await session.commit()
    await session.refresh(row)
    return conversation_json(row)


@router.get("/openclaw/conversations/{conversation_id}/messages")
async def list_messages(
    conversation_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> list[dict]:
    await owned_conversation(conversation_id, user, session)
    rows = (
        await session.execute(
            select(OpenClawMessage)
            .where(OpenClawMessage.conversation_id == conversation_id)
            .order_by(OpenClawMessage.created_at)
            .limit(200)
        )
    ).scalars().all()
    return [message_json(row) for row in rows]


@router.post("/openclaw/conversations/{conversation_id}/messages")
async def append_message(
    conversation_id: uuid.UUID,
    data: OpenClawMessageCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    conversation = await owned_conversation(conversation_id, user, session)
    if data.external_id:
        existing = (
            await session.execute(
                select(OpenClawMessage).where(
                    OpenClawMessage.conversation_id == conversation_id,
                    OpenClawMessage.external_id == data.external_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return message_json(existing)

    row = OpenClawMessage(
        conversation_id=conversation_id,
        role=data.role,
        content=data.content,
        external_id=data.external_id,
    )
    session.add(row)
    conversation.updated_at = func.now()
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        if data.external_id:
            row = (
                await session.execute(
                    select(OpenClawMessage).where(
                        OpenClawMessage.conversation_id == conversation_id,
                        OpenClawMessage.external_id == data.external_id,
                    )
                )
            ).scalar_one()
        else:
            raise
    await session.refresh(row)
    return message_json(row)
