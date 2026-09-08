import GRDB

/// SQL owned by production recording and compiled independently by macOS host contracts.
enum RecordingPersistenceSQL {
  struct Frame {
    var recordingId: String? = nil
    let capturedAtMs: Int64, elapsedRealtimeMs: Int64, boardId: String?
    let canId: Int?, flags: Int, changedMask1: Int, changedMask2: Int
    let speedCentiKmh: Int, batteryVoltageMv: Int, motorCurrentMa: Int, batteryCurrentMa: Int
    let dutyPermille: Int, pitchCentiDeg: Int, rollCentiDeg: Int, balancePitchCentiDeg: Int
    let balanceCurrentMa: Int, erpm: Int, state: Int, switchState: Int, adc1Milli: Int, adc2Milli: Int
    let odometerCm: Int64?, tempMosfetDeciC: Int?, tempMotorDeciC: Int?
  }

  static func frameArguments(_ f: Frame) -> StatementArguments {
    [f.capturedAtMs, f.elapsedRealtimeMs, f.boardId, f.recordingId, f.canId, f.flags, f.changedMask1, f.changedMask2,
     f.speedCentiKmh, f.batteryVoltageMv, f.motorCurrentMa, f.batteryCurrentMa, f.dutyPermille,
     f.pitchCentiDeg, f.rollCentiDeg, f.balancePitchCentiDeg, f.balanceCurrentMa, f.erpm, f.state,
     f.switchState, f.adc1Milli, f.adc2Milli, f.odometerCm, f.tempMosfetDeciC, f.tempMotorDeciC]
  }

  static func bucketArguments(_ b: TelemetryBucket) -> StatementArguments {
    [
      b.bucketStartMs, b.boardId, b.recordingId, b.sampleCount, b.firstSampleAtMs, b.lastSampleAtMs,
      b.sumAbsSpeedCentiKmh, b.movingSpeedSampleCount, b.sumMovingAbsSpeedCentiKmh, b.maxAbsSpeedCentiKmh,
      b.minBatteryVoltageMv, b.maxMotorCurrentAbsMa, b.maxBatteryCurrentAbsMa, b.batteryUsedWhMilli,
      b.batteryRegenWhMilli, b.maxDutyAbsPermille, b.firstOdometerCm, b.lastOdometerCm,
      b.gpsPointCount, b.preciseGpsPointCount, b.gpsDistanceCm, b.maxGpsSpeedCentiMps, b.maxTempMosfetDeciC,
      b.maxTempMotorDeciC, b.firstLatitudeE7, b.firstLongitudeE7, b.firstMovingAtMs, b.lastMovingAtMs,
    ]
  }

  static let insertFrame = """
    INSERT INTO telemetry_frames (
      captured_at_ms, elapsed_realtime_ms, board_id, recording_id, can_id, flags, changed_mask_1, changed_mask_2,
      speed_centi_kmh, battery_voltage_mv, motor_current_ma, battery_current_ma, duty_permille,
      pitch_centi_deg, roll_centi_deg, balance_pitch_centi_deg, balance_current_ma, erpm, state,
      switch_state, adc1_milli, adc2_milli, odometer_cm, temp_mosfet_deci_c, temp_motor_deci_c
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

  static let upsertBucket = """
      INSERT INTO telemetry_minute_buckets (
        bucket_start_ms, board_id, recording_id, sample_count, first_sample_at_ms, last_sample_at_ms,
        sum_abs_speed_centi_kmh, moving_speed_sample_count, sum_moving_abs_speed_centi_kmh,
        max_abs_speed_centi_kmh, min_battery_voltage_mv, max_motor_current_abs_ma,
        max_battery_current_abs_ma, battery_used_wh_milli, battery_regen_wh_milli, max_duty_abs_permille,
        first_odometer_cm, last_odometer_cm, gps_point_count, precise_gps_point_count,
        gps_distance_cm, max_gps_speed_centi_mps, max_temp_mosfet_deci_c, max_temp_motor_deci_c,
        first_latitude_e7, first_longitude_e7, first_moving_at_ms, last_moving_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_start_ms, board_id, recording_id) DO UPDATE SET
        sample_count=telemetry_minute_buckets.sample_count + excluded.sample_count,
        last_sample_at_ms=MAX(telemetry_minute_buckets.last_sample_at_ms, excluded.last_sample_at_ms),
        sum_abs_speed_centi_kmh=telemetry_minute_buckets.sum_abs_speed_centi_kmh + excluded.sum_abs_speed_centi_kmh,
        moving_speed_sample_count=telemetry_minute_buckets.moving_speed_sample_count + excluded.moving_speed_sample_count,
        sum_moving_abs_speed_centi_kmh=telemetry_minute_buckets.sum_moving_abs_speed_centi_kmh + excluded.sum_moving_abs_speed_centi_kmh,
        max_abs_speed_centi_kmh=MAX(telemetry_minute_buckets.max_abs_speed_centi_kmh, excluded.max_abs_speed_centi_kmh),
        min_battery_voltage_mv=MIN(telemetry_minute_buckets.min_battery_voltage_mv, excluded.min_battery_voltage_mv),
        max_motor_current_abs_ma=MAX(telemetry_minute_buckets.max_motor_current_abs_ma, excluded.max_motor_current_abs_ma),
        max_battery_current_abs_ma=MAX(telemetry_minute_buckets.max_battery_current_abs_ma, excluded.max_battery_current_abs_ma),
        battery_used_wh_milli=telemetry_minute_buckets.battery_used_wh_milli + excluded.battery_used_wh_milli,
        battery_regen_wh_milli=telemetry_minute_buckets.battery_regen_wh_milli + excluded.battery_regen_wh_milli,
        max_duty_abs_permille=MAX(telemetry_minute_buckets.max_duty_abs_permille, excluded.max_duty_abs_permille),
        last_odometer_cm=COALESCE(excluded.last_odometer_cm, telemetry_minute_buckets.last_odometer_cm),
        -- The two streams flush on their own clocks, so a minute's first flush can carry frames and
        -- no fix at all. Without this the bucket's route point would stay NULL forever even though a
        -- fix arrived in the very next flush of the same minute.
        first_latitude_e7=COALESCE(telemetry_minute_buckets.first_latitude_e7, excluded.first_latitude_e7),
        first_longitude_e7=COALESCE(telemetry_minute_buckets.first_longitude_e7, excluded.first_longitude_e7),
        gps_point_count=telemetry_minute_buckets.gps_point_count + excluded.gps_point_count,
        precise_gps_point_count=telemetry_minute_buckets.precise_gps_point_count + excluded.precise_gps_point_count,
        gps_distance_cm=telemetry_minute_buckets.gps_distance_cm + excluded.gps_distance_cm,
        max_gps_speed_centi_mps=MAX(telemetry_minute_buckets.max_gps_speed_centi_mps, excluded.max_gps_speed_centi_mps),
        max_temp_mosfet_deci_c=MAX(telemetry_minute_buckets.max_temp_mosfet_deci_c, excluded.max_temp_mosfet_deci_c),
        max_temp_motor_deci_c=MAX(telemetry_minute_buckets.max_temp_motor_deci_c, excluded.max_temp_motor_deci_c),
        first_moving_at_ms=MIN(telemetry_minute_buckets.first_moving_at_ms, excluded.first_moving_at_ms),
        last_moving_at_ms=MAX(telemetry_minute_buckets.last_moving_at_ms, excluded.last_moving_at_ms)
    """
}
