import { addMapDisplayListener, mapDisplayCommand } from 'vescape-core'
import { MotionDisplay } from './display'

export function createMotionDisplay(id: 'live' | 'bench') {
  return new MotionDisplay(id, { command: mapDisplayCommand, subscribe: addMapDisplayListener })
}
