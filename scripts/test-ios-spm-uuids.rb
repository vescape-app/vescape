# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# This source code is licensed under the MIT license found in the
# LICENSE file in the root directory of this source tree.

require "test/unit"
require "fileutils"
require "cocoapods"
require "tmpdir"
require_relative "../node_modules/react-native/scripts/cocoapods/spm.rb"

class SPMTests < Test::Unit::TestCase
  PodSpecStub = Struct.new(:name)
  InstallerStub = Struct.new(:pods_project)

  POD_NAME = "ReactNativeEnrichedMarkdown"

  def setup
    @tmp_dir = Dir.mktmpdir("vescape-spm-test")
  end

  def teardown
    FileUtils.remove_entry(@tmp_dir)
  end

  def build_project(num_pods)
    path = File.join(@tmp_dir, "Pods.xcodeproj")
    FileUtils.mkdir_p(path)
    project = Pod::Project.new(path)
    num_pods.times { |i| project.new_target(:static_library, "Pod#{i}", :ios) }
    project.new_target(:static_library, POD_NAME, :ios)
    project.save
    project
  end

  def inject_spm(project)
    manager = SPMManager.new
    manager.dependency(
      PodSpecStub.new(POD_NAME),
      url: "https://github.com/software-mansion-labs/RaTeX.git",
      requirement: { kind: "upToNextMajorVersion", minimumVersion: "0.1.0" },
      products: ["RaTeX"]
    )
    manager.apply_on_post_install(InstallerStub.new(project))
    project.save
  end

  def simulate_reload(project)
    project.instance_variable_set(:@generated_uuids, [])
    project.instance_variable_set(:@available_uuids, [])
  end

  def assert_loadable_project(path)
    reopened = nil
    assert_nothing_raised("Pods project must reload cleanly after SPM injection") do
      reopened = Xcodeproj::Project.open(path)
    end
    root_uuid = reopened.root_object.uuid
    assert(
      reopened.objects_by_uuid[root_uuid].is_a?(Xcodeproj::Project::Object::PBXProject),
      "rootObject UUID must resolve to a PBXProject"
    )
    package_uuids = reopened.root_object.package_references.map(&:uuid)
    assert(
      package_uuids.none? { |uuid| uuid == root_uuid },
      "injected package reference must not collide with the root object UUID"
    )
    reopened
  end

  def test_spm_injection_on_freshly_generated_project_reloads_cleanly
    project = build_project(88)
    inject_spm(project)
    assert_loadable_project(project.path)
  end

  def test_spm_injection_after_project_reload_does_not_collide_with_root_object
    project = build_project(88)
    simulate_reload(project)
    inject_spm(project)
    assert_loadable_project(project.path)
  end

  def test_injected_uuids_are_unique_across_all_objects
    project = build_project(88)
    simulate_reload(project)
    inject_spm(project)
    reopened = assert_loadable_project(project.path)
    uuids = reopened.objects.map(&:uuid)
    assert_equal(uuids.length, uuids.uniq.length, "all object UUIDs must be unique")
  end
end
