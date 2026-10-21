import { makeMutable, type SharedValue } from 'react-native-reanimated'
import { scheduleOnUI } from 'react-native-worklets'
import type { LiveStateEvent, TelemetryEvent } from 'vescape-core'

import { finite, absolute } from '@/helpers/finite'

interface LiveTelemetryValues {
  speedKmh: SharedValue<number | null>
  dutyPercent: SharedValue<number | null>
  /** Highest speed / duty across the live window, from native. */
  speedPeakKmh: SharedValue<number | null>
  dutyPeakPercent: SharedValue<number | null>
  motorCurrent: SharedValue<number | null>
  batteryCurrent: SharedValue<number | null>
  batteryVoltage: SharedValue<number | null>
  batteryPercent: SharedValue<number | null>
  motorTemp: SharedValue<number | null>
  controllerTemp: SharedValue<number | null>
  pitch: SharedValue<number | null>
  roll: SharedValue<number | null>
  balancePitch: SharedValue<number | null>
  adc1: SharedValue<number | null>
  adc2: SharedValue<number | null>
  lastPacketAt: SharedValue<number | null>
  avgLatencyMs: SharedValue<number | null>
  pullRateHz: SharedValue<number | null>
}

/** Plain scalar bundle shipped to the UI thread in one hop, instead of separate SharedValue writes. */
type TickScalars = Record<keyof LiveTelemetryValues, number | null>

const EMPTY_TICK: TickScalars = {
  speedKmh: null,
  dutyPercent: null,
  speedPeakKmh: null,
  dutyPeakPercent: null,
  motorCurrent: null,
  batteryCurrent: null,
  batteryVoltage: null,
  batteryPercent: null,
  motorTemp: null,
  controllerTemp: null,
  pitch: null,
  roll: null,
  balancePitch: null,
  adc1: null,
  adc2: null,
  lastPacketAt: null,
  avgLatencyMs: null,
  pullRateHz: null,
}

export interface LiveTelemetryRuntime {
  values: LiveTelemetryValues
  syncConnectionSeq: (connectionSeq: number) => void
  seedFromBoardState: (state: LiveStateEvent['board']) => void
  /** Per-frame presentation values; native owns telemetry history and series. */
  ingestTick: (tick: TelemetryEvent) => void
  reset: () => void
}

function dutyPercent(value: number | null | undefined): number | null {
  const finiteValue = absolute(value)
  return finiteValue == null ? null : finiteValue * 100
}

function createValues(): LiveTelemetryValues {
  return {
    speedKmh: makeMutable<number | null>(null),
    dutyPercent: makeMutable<number | null>(null),
    speedPeakKmh: makeMutable<number | null>(null),
    dutyPeakPercent: makeMutable<number | null>(null),
    motorCurrent: makeMutable<number | null>(null),
    batteryCurrent: makeMutable<number | null>(null),
    batteryVoltage: makeMutable<number | null>(null),
    batteryPercent: makeMutable<number | null>(null),
    motorTemp: makeMutable<number | null>(null),
    controllerTemp: makeMutable<number | null>(null),
    pitch: makeMutable<number | null>(null),
    roll: makeMutable<number | null>(null),
    balancePitch: makeMutable<number | null>(null),
    adc1: makeMutable<number | null>(null),
    adc2: makeMutable<number | null>(null),
    lastPacketAt: makeMutable<number | null>(null),
    avgLatencyMs: makeMutable<number | null>(null),
    pullRateHz: makeMutable<number | null>(null),
  }
}

/** Pure JS projection of a telemetry frame into the scalar bundle. No SharedValue writes. */
function tickScalars(telemetry: TelemetryEvent): TickScalars {
  return {
    speedKmh: absolute(telemetry.speed),
    dutyPercent: dutyPercent(telemetry.dutyCycle),
    speedPeakKmh: finite(telemetry.speedPeak),
    dutyPeakPercent: finite(telemetry.dutyPeak),
    motorCurrent: finite(telemetry.motorCurrent),
    batteryCurrent: finite(telemetry.batteryCurrent),
    batteryVoltage: finite(telemetry.batteryVoltage),
    batteryPercent: finite(telemetry.batteryPercent),
    motorTemp: telemetry.tempMotor != null && telemetry.tempMotor > 0 ? telemetry.tempMotor : null,
    controllerTemp: finite(telemetry.tempMosfet),
    pitch: finite(telemetry.pitch),
    roll: finite(telemetry.roll),
    balancePitch: finite(telemetry.balancePitch),
    adc1: finite(telemetry.adc1),
    adc2: finite(telemetry.adc2),
    lastPacketAt: finite(telemetry.lastPacketAt),
    avgLatencyMs: finite(telemetry.avgLatency),
    pullRateHz: finite(telemetry.pullRateHz),
  }
}

export function createLiveTelemetryRuntime(): LiveTelemetryRuntime {
  const values = createValues()

  // One UI-thread worklet assigns all SharedValues. Only the scalar bundle crosses the
  // JS→UI boundary (a single serialization per frame) instead of separate `.value=` hops
  // on the JS thread, which were the dominant live-telemetry cost (createSerializable + GC).
  function applyTick(next: TickScalars): void {
    'worklet'
    values.speedKmh.value = next.speedKmh
    values.dutyPercent.value = next.dutyPercent
    values.speedPeakKmh.value = next.speedPeakKmh
    values.dutyPeakPercent.value = next.dutyPeakPercent
    values.motorCurrent.value = next.motorCurrent
    values.batteryCurrent.value = next.batteryCurrent
    values.batteryVoltage.value = next.batteryVoltage
    values.batteryPercent.value = next.batteryPercent
    values.motorTemp.value = next.motorTemp
    values.controllerTemp.value = next.controllerTemp
    values.pitch.value = next.pitch
    values.roll.value = next.roll
    values.balancePitch.value = next.balancePitch
    values.adc1.value = next.adc1
    values.adc2.value = next.adc2
    values.lastPacketAt.value = next.lastPacketAt
    values.avgLatencyMs.value = next.avgLatencyMs
    values.pullRateHz.value = next.pullRateHz
  }

  function pushTick(next: TickScalars): void {
    scheduleOnUI(applyTick, next)
  }

  let connectionSeq = 0

  return {
    values,

    syncConnectionSeq(nextConnectionSeq) {
      connectionSeq = nextConnectionSeq
    },

    seedFromBoardState(state) {
      connectionSeq = state.connectionSeq
      let latest: TelemetryEvent | null = null
      for (const telemetry of state.recentTelemetry) {
        if (latest === null || telemetry.lastPacketAt > latest.lastPacketAt) latest = telemetry
      }
      pushTick(latest ? tickScalars(latest) : EMPTY_TICK)
    },

    ingestTick(tick) {
      if (tick.generation != null && tick.generation !== connectionSeq) return
      pushTick(tickScalars(tick))
    },

    reset() {
      pushTick(EMPTY_TICK)
    },
  }
}

export const liveTelemetryRuntime = createLiveTelemetryRuntime()
