export interface BoardSwitchPort {
  stopTelemetryRecording(): void
  disconnect(): Promise<void>
  setActiveBoard(id: string): void
}

export async function switchBoard(
  currentBoardId: string | null,
  nextBoardId: string,
  { stopTelemetryRecording, disconnect, setActiveBoard }: BoardSwitchPort,
): Promise<void> {
  if (currentBoardId === nextBoardId) return

  stopTelemetryRecording()
  await disconnect()
  setActiveBoard(nextBoardId)
}
