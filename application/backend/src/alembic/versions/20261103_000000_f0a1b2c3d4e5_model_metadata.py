"""Add user-editable model descriptions and tags.

Revision ID: f0a1b2c3d4e5
Revises: 91d5e3a7c2b0
"""

import sqlalchemy as sa

from alembic import op

revision = "f0a1b2c3d4e5"
down_revision = "91d5e3a7c2b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add editable description and tags to existing models."""
    with op.batch_alter_table("models") as batch_op:
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    """Remove editable model metadata columns."""
    with op.batch_alter_table("models") as batch_op:
        batch_op.drop_column("tags")
        batch_op.drop_column("description")
