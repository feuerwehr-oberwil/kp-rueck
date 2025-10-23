from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional

# Personnel Schemas
class PersonnelBase(BaseModel):
    name: str
    role: str
    status: str

class PersonnelCreate(PersonnelBase):
    pass

class PersonnelUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None

class Personnel(PersonnelBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# Material Schemas
class MaterialBase(BaseModel):
    name: str
    category: str
    status: str

class MaterialCreate(MaterialBase):
    pass

class MaterialUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    status: Optional[str] = None

class Material(MaterialBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# Operation Schemas
class OperationBase(BaseModel):
    location: str
    vehicle: Optional[str] = None
    incident_type: str
    dispatch_time: datetime
    crew: List[str] = []
    priority: str
    status: str
    coordinates: List[float]
    materials: List[str] = []
    notes: str = ""
    contact: str = ""

class OperationCreate(OperationBase):
    pass

class OperationUpdate(BaseModel):
    location: Optional[str] = None
    vehicle: Optional[str] = None
    incident_type: Optional[str] = None
    dispatch_time: Optional[datetime] = None
    crew: Optional[List[str]] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    coordinates: Optional[List[float]] = None
    materials: Optional[List[str]] = None
    notes: Optional[str] = None
    contact: Optional[str] = None

class Operation(OperationBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
