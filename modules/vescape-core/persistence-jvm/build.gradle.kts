plugins {
  kotlin("jvm") version "2.1.20"
  id("com.google.devtools.ksp") version "2.1.20-2.0.1"
}
kotlin { jvmToolchain(17) }

val productionRoot = layout.projectDirectory.dir("../android/src/main/java")
val generatedProduction = layout.buildDirectory.dir("generated/production-kotlin")
val extractProductionPersistence by tasks.registering {
  inputs.dir(productionRoot)
  outputs.dir(generatedProduction)
  doLast {
    val output = generatedProduction.get().asFile
    delete(output)
    listOf(
      "expo/modules/vescapecore/alerts/AlertDefaults.kt",
      "expo/modules/vescapecore/warnings/BoardWarningSeverity.kt",
      "expo/modules/vescapecore/config/BoardConfigChangeNotice.kt",
      "expo/modules/vescapecore/config/RefloatConfigSchema.kt",
      "expo/modules/vescapecore/telemetry/TelemetryEntities.kt",
      "expo/modules/vescapecore/telemetry/HistoryGpsProjection.kt",
      "expo/modules/vescapecore/location/GpsAccuracy.kt",
      "expo/modules/vescapecore/telemetry/TelemetryDao.kt",
      "expo/modules/vescapecore/telemetry/ConfigPersistence.kt",
      "expo/modules/vescapecore/telemetry/TuneAlertPersistence.kt",
      "expo/modules/vescapecore/telemetry/BoardSettingsPersistence.kt",
      "expo/modules/vescapecore/telemetry/RecordingPersistence.kt",
      "expo/modules/vescapecore/telemetry/TelemetryRoomDatabase.kt",
      "expo/modules/vescapecore/telemetry/DatabaseUpgradeContract.kt",
      "expo/modules/vescapecore/telemetry/TelemetryMigrations.kt",
      "expo/modules/vescapecore/telemetry/DatabaseFileSwap.kt",
      "expo/modules/vescapecore/telemetry/DatabaseBackupArchive.kt",
      "expo/modules/vescapecore/telemetry/PersistenceDefaults.kt",
      "expo/modules/vescapecore/telemetry/TelemetryBucketBuilder.kt",
      "expo/modules/vescapecore/telemetry/MetricSanitizer.kt",
      "expo/modules/vescapecore/telemetry/sanitizers/MetricSampleSanitizer.kt",
      "expo/modules/vescapecore/telemetry/sanitizers/LowSpeedAverageSpeedSanitizer.kt",
      "expo/modules/vescapecore/telemetry/sanitizers/FreeSpinMetricSanitizer.kt",
      "expo/modules/vescapecore/telemetry/RideHistoryRepository.kt",
      "expo/modules/vescapecore/telemetry/ProfileStatsRepository.kt",
      "expo/modules/vescapecore/telemetry/FavoriteSummaryBuilder.kt",
      "expo/modules/vescapecore/telemetry/TelemetryRangeSubtraction.kt",
      "expo/modules/vescapecore/telemetry/TelemetryMaintenancePersistence.kt",
    ).forEach { relative ->
      val source = productionRoot.file(relative).asFile.readText()
      output.resolve(relative).apply { parentFile.mkdirs(); writeText(source) }
    }
  }
}

kotlin.sourceSets.main { kotlin.srcDir(generatedProduction) }
tasks.named("compileKotlin") { dependsOn(extractProductionPersistence) }
tasks.matching { it.name.startsWith("ksp") }.configureEach { dependsOn(extractProductionPersistence) }
dependencies {
  implementation("androidx.room:room-runtime:2.8.4")
  implementation("androidx.sqlite:sqlite-bundled:2.6.2")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
  implementation("org.json:json:20231013")
  ksp("androidx.room:room-compiler:2.8.4")
  testImplementation("junit:junit:4.13.2")
}

tasks.withType<Test>().configureEach {
  // Host contracts consume shared fixtures and per-run cross-platform artifacts outside this
  // Gradle project. Never reuse a prior test result for a different archive exchange.
  outputs.upToDateWhen { false }
  outputs.cacheIf { false }
}
