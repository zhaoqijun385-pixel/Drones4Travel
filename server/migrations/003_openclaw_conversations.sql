-- 003_openclaw_conversations.sql — durable per-user OpenClaw transcripts
-- Run after 001_init_auth_schema.sql and 002_matrix_account.sql.

CREATE TABLE IF NOT EXISTS openclaw_conversation (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    session_key VARCHAR(255) NOT NULL,
    title VARCHAR(160),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_openclaw_conversation_user_session UNIQUE (user_id, session_key),
    FOREIGN KEY(user_id) REFERENCES "user" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_openclaw_conversation_user_id
    ON openclaw_conversation (user_id);

CREATE TABLE IF NOT EXISTS openclaw_message (
    id UUID NOT NULL,
    conversation_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    external_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_openclaw_message_conversation_external
        UNIQUE (conversation_id, external_id),
    FOREIGN KEY(conversation_id) REFERENCES openclaw_conversation (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_openclaw_message_conversation_id
    ON openclaw_message (conversation_id);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON openclaw_conversation, openclaw_message TO drone_api;
