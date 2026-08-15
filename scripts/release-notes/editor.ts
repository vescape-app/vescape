export interface EditorEnvironment {
  VISUAL?: string
  EDITOR?: string
}

export function resolveEditorCommand(
  environment: EditorEnvironment = {
    VISUAL: process.env.VISUAL,
    EDITOR: process.env.EDITOR,
  },
  available: (program: string) => boolean = (program) => Bun.which(program) !== null,
): string[] {
  const configured = environment.VISUAL?.trim() || environment.EDITOR?.trim()
  if (configured) {
    const command = configured.split(/\s+/)
    if (!available(command[0]))
      throw new Error(`Configured editor "${command[0]}" is not installed`)
    return command
  }

  const fallback = [['zed', '--wait'], ['nano'], ['vim'], ['vi']].find(([program]) =>
    available(program),
  )
  if (!fallback) throw new Error('No editor found; set $VISUAL or $EDITOR before authoring notes')
  return fallback
}
