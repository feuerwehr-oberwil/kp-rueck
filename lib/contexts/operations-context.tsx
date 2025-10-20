"use client"

import { createContext, useContext, useState, ReactNode } from "react"

// Types
export type PersonStatus = "available" | "assigned"
export type PersonRole = "Mannschaft" | "Fahrer" | "Reko/EL/FU"

export interface Person {
  id: string
  name: string
  role: PersonRole
  status: PersonStatus
}

export type OperationStatus = "incoming" | "ready" | "enroute" | "active" | "returning" | "complete"
export type VehicleType = "TLF" | "Pio" | "Unimog" | "Trawa" | "Mawa" | null

export interface Operation {
  id: string
  location: string
  vehicle: VehicleType
  incidentType: string
  dispatchTime: Date
  crew: string[]
  priority: "high" | "medium" | "low"
  status: OperationStatus
  coordinates: [number, number]
  materials: string[]
  notes: string
  contact: string
}

export interface Material {
  id: string
  name: string
  category: string
  status: "available" | "assigned"
}

// Initial data
export const initialMaterials: Material[] = [
  { id: "m1", name: "Wasserpumpe TP 15/8", category: "Pumpen", status: "available" },
  { id: "m2", name: "Schlauchpaket B", category: "Schläuche", status: "available" },
  { id: "m3", name: "Schlauchpaket C", category: "Schläuche", status: "available" },
  { id: "m4", name: "Atemschutzgerät", category: "Atemschutz", status: "assigned" },
  { id: "m5", name: "Wärmebildkamera", category: "Spezialgerät", status: "available" },
  { id: "m6", name: "Hydraulisches Rettungsgerät", category: "Spezialgerät", status: "available" },
  { id: "m7", name: "Schaummittel 200L", category: "Löschmittel", status: "available" },
  { id: "m8", name: "Stromerzeuger 5kW", category: "Technik", status: "available" },
]

export const initialPersonnel: Person[] = [
  { id: "1", name: "M. Schmidt", role: "Fahrer", status: "available" },
  { id: "2", name: "A. Müller", role: "Reko/EL/FU", status: "available" },
  { id: "3", name: "T. Weber", role: "Mannschaft", status: "available" },
  { id: "4", name: "S. Fischer", role: "Mannschaft", status: "available" },
  { id: "5", name: "K. Wagner", role: "Fahrer", status: "available" },
  { id: "6", name: "L. Becker", role: "Mannschaft", status: "available" },
  { id: "7", name: "P. Hoffmann", role: "Reko/EL/FU", status: "available" },
  { id: "8", name: "J. Schulz", role: "Mannschaft", status: "available" },
]

export const initialOperations: Operation[] = [
  {
    id: "1",
    location: "Hauptstraße 45",
    vehicle: "TLF",
    incidentType: "Wohnungsbrand",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 12),
    crew: ["M. Schmidt", "T. Weber"],
    priority: "high",
    status: "active",
    coordinates: [51.1657, 10.4515],
    materials: ["m1", "m4"],
    notes: "",
    contact: "",
  },
  {
    id: "2",
    location: "Industriepark Nord",
    vehicle: "Pio",
    incidentType: "Technische Hilfe",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 5),
    crew: ["K. Wagner"],
    priority: "medium",
    status: "enroute",
    coordinates: [51.1757, 10.4615],
    materials: ["m6"],
    notes: "",
    contact: "",
  },
  {
    id: "3",
    location: "Bahnhofstraße 12",
    vehicle: null,
    incidentType: "Fehlalarm",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 45),
    crew: [],
    priority: "low",
    status: "returning",
    coordinates: [51.1557, 10.4415],
    materials: [],
    notes: "",
    contact: "",
  },
  {
    id: "4",
    location: "Waldweg 8",
    vehicle: null,
    incidentType: "Ölspur",
    dispatchTime: new Date(Date.now() - 1000 * 60 * 2),
    crew: [],
    priority: "low",
    status: "ready",
    coordinates: [51.1857, 10.4715],
    materials: [],
    notes: "",
    contact: "",
  },
]

// Context type
interface OperationsContextType {
  personnel: Person[]
  setPersonnel: React.Dispatch<React.SetStateAction<Person[]>>
  materials: Material[]
  setMaterials: React.Dispatch<React.SetStateAction<Material[]>>
  operations: Operation[]
  setOperations: React.Dispatch<React.SetStateAction<Operation[]>>
  removeCrew: (operationId: string, crewName: string) => void
  removeMaterial: (operationId: string, materialId: string) => void
  updateOperation: (operationId: string, updates: Partial<Operation>) => void
  createOperation: (operation: Omit<Operation, "id" | "dispatchTime">) => void
  getNextOperationId: () => string
}

const OperationsContext = createContext<OperationsContextType | undefined>(undefined)

export function OperationsProvider({ children }: { children: ReactNode }) {
  const [personnel, setPersonnel] = useState<Person[]>(initialPersonnel)
  const [materials, setMaterials] = useState<Material[]>(initialMaterials)
  const [operations, setOperations] = useState<Operation[]>(initialOperations)

  const removeCrew = (operationId: string, crewName: string) => {
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          return {
            ...op,
            crew: op.crew.filter((name) => name !== crewName),
          }
        }
        return op
      }),
    )

    const person = personnel.find((p) => p.name === crewName)
    if (person) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.crew.includes(crewName))
      if (!stillAssigned) {
        setPersonnel((people) =>
          people.map((p) => (p.id === person.id ? { ...p, status: "available" as PersonStatus } : p)),
        )
      }
    }
  }

  const removeMaterial = (operationId: string, materialId: string) => {
    setOperations((ops) =>
      ops.map((op) => {
        if (op.id === operationId) {
          return {
            ...op,
            materials: op.materials.filter((id) => id !== materialId),
          }
        }
        return op
      }),
    )

    const material = materials.find((m) => m.id === materialId)
    if (material) {
      const stillAssigned = operations.some(op => op.id !== operationId && op.materials.includes(materialId))
      if (!stillAssigned) {
        setMaterials((mats) =>
          mats.map((m) => (m.id === material.id ? { ...m, status: "available" as Material["status"] } : m)),
        )
      }
    }
  }

  const updateOperation = (operationId: string, updates: Partial<Operation>) => {
    setOperations((ops) =>
      ops.map((op) => (op.id === operationId ? { ...op, ...updates } : op)),
    )
  }

  const getNextOperationId = () => {
    const maxId = Math.max(...operations.map(op => parseInt(op.id) || 0))
    return String(maxId + 1)
  }

  const createOperation = (operation: Omit<Operation, "id" | "dispatchTime">) => {
    const newOperation: Operation = {
      ...operation,
      id: getNextOperationId(),
      dispatchTime: new Date(),
    }
    setOperations((ops) => [newOperation, ...ops])
  }

  return (
    <OperationsContext.Provider
      value={{
        personnel,
        setPersonnel,
        materials,
        setMaterials,
        operations,
        setOperations,
        removeCrew,
        removeMaterial,
        updateOperation,
        createOperation,
        getNextOperationId,
      }}
    >
      {children}
    </OperationsContext.Provider>
  )
}

export function useOperations() {
  const context = useContext(OperationsContext)
  if (context === undefined) {
    throw new Error("useOperations must be used within an OperationsProvider")
  }
  return context
}
