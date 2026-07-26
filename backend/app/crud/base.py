"""Generic base CRUD operations."""

from typing import Any, Protocol, TypeVar
from uuid import UUID

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import Base
from ..models import User
from ..services.audit import calculate_changes, log_action


class ModelProtocol(Protocol):
    """What CRUDBase actually requires of a model.

    Every model it operates on has a UUID primary key called `id`, and the audit log reads
    `__tablename__`/`__name__` off the class. `Base` (DeclarativeBase) declares none of
    those, so binding the type variable to `Base` alone made every `self.model.id` an
    attribute error — 20-odd findings that all described the same missing statement of an
    always-implicit requirement. Stating it here fixes them at the source rather than with
    an ignore per call site.
    """

    id: Any
    __tablename__: str

    def __init__(self, **kwargs: Any) -> None: ...


# Type variables for generics
ModelType = TypeVar("ModelType", bound=Base)
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


class CRUDBase[ModelType: ModelProtocol, CreateSchemaType: BaseModel, UpdateSchemaType: BaseModel]:
    """Base class for CRUD operations.

    Provides common database operations for all models.
    Reduces code duplication across CRUD modules.
    """

    def __init__(self, model: type[ModelType]) -> None:
        """Initialize CRUD base with model class.

        Args:
            model: SQLAlchemy model class
        """
        self.model = model

    async def get(
        self,
        db: AsyncSession,
        id: UUID,
    ) -> ModelType | None:
        """Get a single record by ID.

        Args:
            db: Database session
            id: Record UUID

        Returns:
            Model instance or None if not found
        """
        result = await db.execute(select(self.model).where(self.model.id == id))
        return result.scalar_one_or_none()

    async def get_multi(
        self,
        db: AsyncSession,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> list[ModelType]:
        """Get multiple records with pagination.

        Args:
            db: Database session
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of model instances
        """
        result = await db.execute(select(self.model).offset(skip).limit(limit))
        return list(result.scalars().all())

    async def create(
        self,
        db: AsyncSession,
        *,
        obj_in: CreateSchemaType,
        current_user: User | None = None,
        request: Request | None = None,
    ) -> ModelType:
        """Create a new record.

        Args:
            db: Database session
            obj_in: Pydantic schema with creation data
            current_user: User creating the record (for audit)
            request: HTTP request (for audit)

        Returns:
            Created model instance
        """
        # Convert Pydantic model to dict
        obj_in_data = obj_in.model_dump()

        # Create model instance
        db_obj = self.model(**obj_in_data)
        db.add(db_obj)
        await db.flush()

        # Log creation if user and request provided
        if current_user and request:
            await log_action(
                db=db,
                action_type="create",
                resource_type=self.model.__tablename__,
                resource_id=db_obj.id,
                user=current_user,
                changes={"created": obj_in_data},
                request=request,
            )

        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def update(
        self,
        db: AsyncSession,
        *,
        db_obj: ModelType,
        obj_in: UpdateSchemaType | dict[str, Any],
        current_user: User | None = None,
        request: Request | None = None,
    ) -> ModelType:
        """Update an existing record.

        Args:
            db: Database session
            db_obj: Existing model instance to update
            obj_in: Pydantic schema or dict with update data
            current_user: User updating the record (for audit)
            request: HTTP request (for audit)

        Returns:
            Updated model instance
        """
        # Get update data as dict
        update_data = obj_in if isinstance(obj_in, dict) else obj_in.model_dump(exclude_unset=True)

        # Capture before state for audit
        before_state = {}
        for field in update_data:
            if hasattr(db_obj, field):
                before_state[field] = getattr(db_obj, field)

        # Apply updates
        for field, value in update_data.items():
            if hasattr(db_obj, field):
                setattr(db_obj, field, value)

        # Capture after state for audit
        after_state = {}
        for field in update_data:
            if hasattr(db_obj, field):
                after_state[field] = getattr(db_obj, field)

        # Calculate changes and log if user and request provided
        if current_user and request:
            changes = calculate_changes(before_state, after_state)
            if changes:
                await log_action(
                    db=db,
                    action_type="update",
                    resource_type=self.model.__tablename__,
                    resource_id=db_obj.id,
                    user=current_user,
                    changes=changes,
                    request=request,
                )

        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    async def delete(
        self,
        db: AsyncSession,
        *,
        id: UUID,
        current_user: User | None = None,
        request: Request | None = None,
    ) -> bool:
        """Delete a record.

        Args:
            db: Database session
            id: Record UUID to delete
            current_user: User deleting the record (for audit)
            request: HTTP request (for audit)

        Returns:
            True if deleted, False if not found
        """
        # Get the object
        obj = await self.get(db=db, id=id)
        if not obj:
            return False

        # Log deletion if user and request provided
        if current_user and request:
            await log_action(
                db=db,
                action_type="delete",
                resource_type=self.model.__tablename__,
                resource_id=id,
                user=current_user,
                request=request,
            )

        # Delete the object
        await db.delete(obj)
        await db.commit()
        return True

    async def get_by_field(
        self,
        db: AsyncSession,
        *,
        field_name: str,
        field_value: Any,
    ) -> ModelType | None:
        """Get a single record by a specific field value.

        Args:
            db: Database session
            field_name: Name of the field to filter by
            field_value: Value to match

        Returns:
            Model instance or None if not found
        """
        if not hasattr(self.model, field_name):
            raise ValueError(f"Model {self.model.__name__} has no field {field_name}")

        result = await db.execute(select(self.model).where(getattr(self.model, field_name) == field_value))
        return result.scalar_one_or_none()

    async def get_multi_by_field(
        self,
        db: AsyncSession,
        *,
        field_name: str,
        field_value: Any,
        skip: int = 0,
        limit: int = 100,
    ) -> list[ModelType]:
        """Get multiple records by a specific field value.

        Args:
            db: Database session
            field_name: Name of the field to filter by
            field_value: Value to match
            skip: Number of records to skip
            limit: Maximum number of records to return

        Returns:
            List of model instances
        """
        if not hasattr(self.model, field_name):
            raise ValueError(f"Model {self.model.__name__} has no field {field_name}")

        result = await db.execute(
            select(self.model).where(getattr(self.model, field_name) == field_value).offset(skip).limit(limit)
        )
        return list(result.scalars().all())

    async def count(
        self,
        db: AsyncSession,
    ) -> int:
        """Count total number of records.

        Args:
            db: Database session

        Returns:
            Total count
        """
        from sqlalchemy import func

        result = await db.execute(select(func.count()).select_from(self.model))
        return result.scalar() or 0

    async def exists(
        self,
        db: AsyncSession,
        *,
        id: UUID,
    ) -> bool:
        """Check if a record exists by ID.

        Args:
            db: Database session
            id: Record UUID

        Returns:
            True if exists, False otherwise
        """
        result = await db.execute(select(self.model.id).where(self.model.id == id))
        return result.scalar_one_or_none() is not None
