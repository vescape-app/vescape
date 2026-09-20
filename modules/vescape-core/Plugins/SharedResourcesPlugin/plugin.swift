import Foundation
import PackagePlugin

/// Keep shared JSON single-source while giving both SwiftPM build systems real bundle files.
@main
struct SharedResourcesPlugin: BuildToolPlugin {
  func createBuildCommands(context: PluginContext, target: Target) throws -> [Command] {
    ["alert-preset-definitions.json", "cell-presets.json"].map { name in
      let link = context.package.directory.appending("ios").appending(name)
      let source = Path(URL(fileURLWithPath: link.string).resolvingSymlinksInPath().path)
      let output = context.pluginWorkDirectory.appending(name)
      return .buildCommand(
        displayName: "Bundle shared \(name)",
        executable: Path("/bin/cp"),
        arguments: [source.string, output.string],
        inputFiles: [source],
        outputFiles: [output]
      )
    }
  }
}
