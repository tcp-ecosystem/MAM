# frozen_string_literal: true

require 'minitest/autorun'
require_relative '../lib/mam'

# Zero-dependency checks for the Ruby SDK.
class MamSdkTest < Minitest::Test
  # Checks twenty section variants.
  def test_section_kinds
    assert_equal 20, Ast::SectionKind::ALL.length
  end

  # Checks authoritative front matter naming.
  def test_front_matter_name
    value = Ast::FrontMatter.new(name: 'x', version: '1', schema_version: '1')
    refute_empty value.name
  end

  # Checks parser sections and code blocks.
  def test_parser_nodes
    module_value = Parser.parse("---\nname: x\nauthors: [A]\n---\n## Purpose\nText\n```python\nprint(1)\n```\n", 'x')
    assert_equal 1, module_value.all_code_blocks.length
  end

  # Checks non-throwing malformed input behavior.
  def test_safe_parse
    refute Parser.safe_parse("---\nname: x\n## Purpose\n", 'x')[:success]
  end

  # Checks validation semantics.
  def test_validation
    module_value = Parser.parse("---\nname: x\nversion: 1\n---\n## Purpose\nok", 'x')
    assert Mam.is_valid_module?(module_value)
  end

  # Checks runtime defaults.
  def test_runtime_config
    assert_equal 60_000, Runtime::ExecutionConfig.defaults.timeout_ms
  end

  # Checks plugin registration.
  def test_plugins
    registry = PluginRegistry.new
    assert registry.register(StubPlugin.new)
  end

  # Checks template rendering.
  def test_template
    rendered = Template.new_module('Demo', 'module', 'author' => 'A')
    assert_includes rendered, 'name: Demo'
  end

  # Checks config merge immutability.
  def test_config
    base = Config.defaults
    assert_equal 'ruby', Config.merge(base, Config::SdkConfig.new(target: 'ruby')).target
    assert_equal 'python', base.target
  end

  # Checks documented null behavior.
  def test_nulls
    assert_equal 'null module', Mam.module_summary(nil)
    refute Validator.new.validate(nil).is_valid
  end

  # Minimal plugin used by the registry check.
  class StubPlugin
    def name
      'stub'
    end

    def version
      '1'
    end

    def hooks
      [PluginRegistry::HookPoint::BEFORE_PARSE]
    end

    def handle(point, _context)
      point
    end
  end
end
