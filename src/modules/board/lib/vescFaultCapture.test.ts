import { describe, expect, it } from 'bun:test'
import type { VescFaultCapture, VescFaultCaptureSample } from 'vescape-core'

import {
  achievedRateHz,
  capturePhase,
  captureSpanMs,
  fmtCaptureOffset,
  samplesAroundIncident,
} from '@/modules/board/lib/vescFaultCapture'

const OPENED = 1_000_000

const capture: VescFaultCapture = {
  occurrenceId: 'occ',
  boardId: 'board',
  startedAtMs: OPENED - 5_000,
  openedAtMs: OPENED,
  endedAtMs: OPENED + 3_000,
  sampleCount: 0,
  complete: true,
}

function sample(atMs: number): VescFaultCaptureSample {
  return {
    capturedAtMs: atMs,
    speed: null,
    dutyCycle: null,
    erpm: null,
    batteryVoltage: null,
    batteryCurrent: null,
    motorCurrent: null,
    tempMosfet: null,
    tempMotor: null,
    pitch: null,
    roll: null,
    balancePitch: null,
    adc1: null,
    adc2: null,
    state: null,
  }
}

describe('capturePhase', () => {
  it('splits pre-roll, incident, and post-clear tail on the occurrence boundaries', () => {
    const cleared = OPENED + 1_000
    expect(capturePhase(sample(OPENED - 1), capture, cleared)).toBe('pre')
    expect(capturePhase(sample(OPENED), capture, cleared)).toBe('incident')
    expect(capturePhase(sample(cleared), capture, cleared)).toBe('incident')
    expect(capturePhase(sample(cleared + 1), capture, cleared)).toBe('tail')
  })

  it('has no tail while the occurrence is still active', () => {
    expect(capturePhase(sample(OPENED + 9_000), capture, null)).toBe('incident')
  })
})

describe('achievedRateHz', () => {
  it('measures the rate the samples actually arrived at, not a fixed cadence', () => {
    const samples = [0, 100, 200, 300].map((d) => sample(OPENED + d))
    expect(achievedRateHz(samples)).toBeCloseTo(10, 5)
  })

  it('reports an irregular response-paced burst as its mean rate', () => {
    const samples = [0, 20, 300, 1_000].map((d) => sample(OPENED + d))
    expect(achievedRateHz(samples)).toBeCloseTo(3, 5)
  })

  it('is unknown below two samples', () => {
    expect(achievedRateHz([])).toBeNull()
    expect(achievedRateHz([sample(OPENED)])).toBeNull()
    expect(captureSpanMs([sample(OPENED)])).toBeNull()
  })
})

describe('samplesAroundIncident', () => {
  it('keeps everything when the capture is small', () => {
    const samples = [OPENED - 100, OPENED, OPENED + 100].map(sample)
    expect(samplesAroundIncident(samples, capture, 10)).toEqual({ shown: samples, omitted: 0 })
  })

  it('centres the window on detection', () => {
    const samples = Array.from({ length: 100 }, (_, i) => sample(OPENED - 5_000 + i * 100))
    const { shown, omitted } = samplesAroundIncident(samples, capture, 10)
    expect(omitted).toBe(90)
    expect(shown).toHaveLength(10)
    // Detection sits at index 50; a 10-wide window centred there starts at 45.
    expect(shown[0].capturedAtMs).toBe(OPENED - 500)
    expect(shown[5].capturedAtMs).toBe(OPENED)
  })

  it('clamps to the end when every sample precedes detection', () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(OPENED - 5_000 + i * 100))
    const { shown } = samplesAroundIncident(samples, capture, 5)
    expect(shown[shown.length - 1]).toBe(samples[samples.length - 1])
  })
})

describe('fmtCaptureOffset', () => {
  it('signs the offset around detection', () => {
    expect(fmtCaptureOffset(-4_830)).toBe('-4.83s')
    expect(fmtCaptureOffset(0)).toBe('+0.00s')
    expect(fmtCaptureOffset(200)).toBe('+0.20s')
  })
})
