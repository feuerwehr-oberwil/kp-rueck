import { createContext } from "react"
import type { BoardSyncStatus, OperationsContextType } from "./types"

export const OperationsContext = createContext<OperationsContextType | undefined>(undefined)
export const BoardSyncStatusContext = createContext<BoardSyncStatus | undefined>(undefined)
