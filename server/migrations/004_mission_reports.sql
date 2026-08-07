-- 004_mission_reports.sql — Task3 customer PDF report index
-- Run after 003_openclaw_conversations.sql.

CREATE TABLE IF NOT EXISTS mission_report (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    title VARCHAR(180) NOT NULL,
    summary TEXT,
    report_payload JSONB NOT NULL,
    pdf_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
    PRIMARY KEY (id),
    FOREIGN KEY(user_id) REFERENCES "user" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_mission_report_user_id
    ON mission_report (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON mission_report TO drone_api;
