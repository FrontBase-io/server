export interface ObjectListener {
  socketId: string
  then: () => void
}

export interface ModelListener {
  socketId: string
  then: () => void
}
