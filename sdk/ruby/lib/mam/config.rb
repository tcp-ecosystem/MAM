# frozen_string_literal: true

module Mam
  require 'json'
require 'fileutils'

  # SDK configuration loading, validation, merging, and file IO.
  module Config
    # Conventional SDK config filename.
    FILE_NAME = 'mam.sdk.json'

    module_function

    # Returns safe defaults.
    def defaults
      SdkConfig.new(version: '1', work_dir: '.', target: 'python', verbose: false, extra: {})
    end

    # Parses flat JSON and rejects unknown top-level keys.
    def from_json(json)
      raw = JSON.parse(TextSupport_config.empty(json))
      raise ArgumentError, 'config root must be an object' unless raw.is_a?(Hash)
      known = %w[version work_dir target verbose extra]
      unknown = raw.keys.map(&:to_s) - known
      raise ArgumentError, "unknown config key: #{unknown.first}" unless unknown.empty?
      merge(defaults, SdkConfig.new(version: raw['version'], work_dir: raw['work_dir'], target: raw['target'],
                                    verbose: raw['verbose'], extra: raw['extra']))
    rescue JSON::ParserError => error
      raise ArgumentError, "invalid JSON: #{error.message}"
    end

    # Loads an explicit UTF-8 config file.
    def load(path)
      raise ArgumentError, 'path is required' if TextSupport_config.blank?(path)
      from_json(File.read(path, encoding: 'UTF-8'))
    end

    # Searches start and ancestors for the conventional filename.
    def find(start = nil)
      current = File.expand_path(TextSupport_config.blank?(start) ? '.' : start)
      loop do
        candidate = File.join(current, FILE_NAME)
        return candidate if File.file?(candidate)
        parent = File.dirname(current)
        return nil if parent == current
        current = parent
      end
    end

    # Saves validated config with deterministic JSON.
    def save(config, path)
      problems = validate(config)
      raise ArgumentError, problems.join('; ') unless problems.empty?
      raise ArgumentError, 'path is required' if TextSupport_config.blank?(path)
      FileUtils.mkdir_p(File.dirname(File.expand_path(path)))
      File.write(path, to_json(config), mode: 'w', encoding: 'UTF-8')
    end

    # Serializes config to stable JSON.
    def to_json(config)
      value = config || defaults
      JSON.pretty_generate(version: value.version, work_dir: value.work_dir, target: value.target,
                            verbose: value.verbose, extra: value.extra) + "\n"
    end

    # Returns supported targets.
    def supported_targets
      %w[python javascript typescript java csharp ruby go rust json yaml]
    end

    # Merges nonblank values and extra keys without mutating inputs.
    def merge(base, override)
      left = base || defaults
      right = override || SdkConfig.new
      extra = left.extra.merge(right.extra)
      SdkConfig.new(version: TextSupport_config.blank?(right.version) ? left.version : right.version,
                    work_dir: TextSupport_config.blank?(right.work_dir) ? left.work_dir : right.work_dir,
                    target: TextSupport_config.blank?(right.target) ? left.target : right.target,
                    verbose: left.verbose || right.verbose, extra: extra)
    end

    # Returns all human-readable configuration problems.
    def validate(config)
      return ['config is null'] if config.nil?
      problems = []
      problems << 'version must be dotted numeric' unless /\A\d+(?:\.\d+)*\z/.match?(config.version)
      problems << 'work_dir is required' if TextSupport_config.blank?(config.work_dir)
      problems << 'target is not supported' unless supported_targets.include?(config.target)
      config.extra.each { |key, value| problems << 'extra keys must be nonblank and values single-line' if TextSupport_config.blank?(key) || value.include?("\n") }
      problems
    end

    # Applies supported MAM environment overrides.
    def with_environment(config)
      base = config || defaults
      merge(base, SdkConfig.new(version: ENV.fetch('MAM_VERSION', ''), work_dir: ENV.fetch('MAM_WORK_DIR', ''),
                                 target: ENV.fetch('MAM_TARGET', ''), verbose: %w[1 true TRUE].include?(ENV.fetch('MAM_VERBOSE', ''))))
    end

    # Resolves the conventional config path under a directory.
    def resolve_path(directory = nil)
      File.join(TextSupport_config.blank?(directory) ? '.' : directory, FILE_NAME)
    end

    # Immutable settings value.
    class SdkConfig
      attr_reader :version, :work_dir, :target, :verbose, :extra

      # Creates normalized config values.
      def initialize(version: '', work_dir: '', target: '', verbose: false, extra: {})
        @version = TextSupport_config.empty(version).strip
        @work_dir = TextSupport_config.empty(work_dir).strip
        @target = TextSupport_config.empty(target).strip.downcase
        @verbose = !!verbose
        @extra = (extra || {}).to_h.transform_keys(&:to_s).transform_values(&:to_s).freeze
        freeze
      end

      # Returns an independent copy.
      def copy
        self.class.new(version: version, work_dir: work_dir, target: target, verbose: verbose, extra: extra.dup)
      end
    end
  end

  module TextSupport_config
    module_function

    # Returns true when +value+ is nil or whitespace-only.
    def blank?(value)
      value.nil? || value.to_s.strip.empty?
    end

    # Coerces nil to an empty string.
    def empty(value)
      value.nil? ? '' : value.to_s
    end

    # Collapses whitespace in a value.
    def normalized(value)
      empty(value).strip.gsub(/\s+/, ' ')
    end

    # Case-insensitive equality for strings.
    def equal_ignore_case?(left, right)
      left.nil? ? right.nil? : left.to_s.casecmp?(right.to_s)
    end

    # Case-insensitive starts-with check.
    def starts_with?(value, prefix)
      !value.nil? && !prefix.nil? && value.to_s.downcase.start_with?(prefix.to_s.downcase)
    end

    # Case-insensitive ends-with check.
    def ends_with?(value, suffix)
      !value.nil? && !suffix.nil? && value.to_s.downcase.end_with?(suffix.to_s.downcase)
    end

    # Truncates without raising for short or nil strings.
    def truncate(value, maximum)
      text = empty(value)
      return '' if maximum.negative?
      return text if text.length <= maximum
      return text[0, maximum] if maximum <= 3
      "#{text[0, maximum - 3]}..."
    end

    # Returns the first line without its newline.
    def first_line(value)
      empty(value).split("\n", 2).first.to_s
    end

    # Returns the last line without its newline.
    def last_line(value)
      empty(value).split("\n").last.to_s
    end

    # Capitalizes the first character.
    def capitalize(value)
      text = empty(value).strip
      text.empty? ? text : text[0].upcase + text[1..]
    end

    # Returns nonblank values as a new array.
    def non_blank(values)
      Array(values).reject { |item| blank?(item) }.map { |item| item.to_s.strip }
    end

    # Returns unique nonblank values in first-seen order.
    def unique(values)
      non_blank(values).each_with_object([]) { |item, output| output << item unless output.include?(item) }
    end

    # Joins a value collection with a separator.
    def joined(values, separator = '')
      Array(values).map { |item| empty(item) }.join(separator.to_s)
    end

    # Counts strings containing a nonblank needle.
    def count_containing(values, needle)
      return 0 if blank?(needle)
      Array(values).count { |item| empty(item).include?(needle.to_s) 
  module UtilitySupport2_config
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_config.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_config.blank?(needle) ? 0 : TextSupport_config.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_config.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_config.empty(value).split("\n").count { |line| !line.strip.empty? }
    end

    # Sums integer values.
    def sum(values)
      Array(values).sum(&:to_i)
    end

    # Returns maximum or zero.
    def maximum(values)
      Array(values).map(&:to_i).max || 0
    end

    # Returns minimum or zero.
    def minimum(values)
      values = Array(values).map(&:to_i)
      values.empty? ? 0 : values.min
    end

    # Returns average or zero.
    def average(values)
      values = Array(values).map(&:to_i)
      values.empty? ? 0.0 : values.sum.to_f / values.length
    end

    # Returns first count values.
    def first(values, count)
      Array(values).first([count.to_i, 0].max)
    end

    # Returns last count values.
    def last(values, count)
      Array(values).last([count.to_i, 0].max)
    end

    # Returns values after count.
    def drop(values, count)
      Array(values).drop([count.to_i, 0].max)
    end

    # Filters containing values.
    def filtered(values, needle)
      return [] if TextSupport_config.blank?(needle)
      Array(values).select { |value| TextSupport_config.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_config.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_config.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_config.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_config.normalized(value).split(' ').each do |word|
        if !current.empty? && current.length + word.length + 1 > width
          lines << current
          current = +''
        elsif !current.empty?
          current << ' '
        end
        current << word
      end
      lines << current unless current.empty?
      lines.join("\n")
    end

    # Escapes a simple CSV cell.
    def csv(value)
      TextSupport_config.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_config.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_config.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_config.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_config.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_config.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_config.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_config.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_config.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_config.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_config.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_config.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_config.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_config.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_config.blank?(value) ? 'module.mam.md' : TextSupport_config.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_config.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_config.non_blank(TextSupport_config.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_config.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_config.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_config.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_config.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_config.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_config.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_config.blank?(value)
    end
  end

}
    end

    # Returns values in reverse order.
    def reversed(values)
      Array(values).map(&:dup).reverse
    end

    # Repeats a character safely.
    def repeated(value, count)
      count.to_i.positive? ? value.to_s * count.to_i : ''
    end

    # Clamps an integer.
    def clamp(value, minimum, maximum)
      [[value.to_i, minimum.to_i].max, maximum.to_i].min
    end

    # Escapes text for a small JSON string body.
    def json_escape(value)
      empty(value).gsub('\\', '\\\\').gsub('"', '\\"').gsub("\n", '\\n').gsub("\r", '\\r').gsub("\t", '\\t')
    end

    # Returns the basename for slash- or backslash-separated paths.
    def file_name(path)
      empty(path).tr('\\', '/').split('/').last.to_s
    end

    # Returns the extension without a dot.
    def extension(path)
      name = file_name(path)
      name.include?('.') ? name.split('.').last : ''
    end

    # Produces a portable hyphenated slug.
    def slug(value)
      output = empty(value).downcase.gsub(Regexp.new('[^a-z0-9]+'), '-').gsub(Regexp.new('\A-+|-+\z'), '')
      output.length > 64 ? output[0, 64].gsub(Regexp.new('-+'), '') : output
    end
  end

end
