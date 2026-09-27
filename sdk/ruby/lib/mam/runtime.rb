# frozen_string_literal: true

module Mam
  require 'open3'
  require 'timeout'

  # Executes MAM code blocks with bounded duration and output.
  class Runtime
    # Creates a runtime with an ExecutionConfig.
    def initialize(config = nil)
      @config = config || ExecutionConfig.defaults
    end

    # Returns a defensive config copy.
    attr_reader :config

    # Returns supported language tags.
    def self.supported_languages
      %w[python python3 javascript node bash sh ruby]
    end

    # Resolves a language to executable and fixed arguments.
    def self.invocation_for(language)
      case TextSupport_runtime.empty(language).strip.downcase
      when 'python', 'python3', 'py' then Invocation.new('python', ['-c'])
      when 'javascript', 'js', 'node' then Invocation.new('node', ['-e'])
      when 'bash', 'sh', 'shell' then Invocation.new('bash', ['-c'])
      when 'ruby', 'rb' then Invocation.new('ruby', ['-e'])
      else raise ExecutionError, "unsupported language: #{language}"
      end
    end

    # Executes one block; expected failures become ExecutionResult values.
    def execute(block)
      return ExecutionResult.new(0, '', 'code block is empty', 0) if block.nil? || TextSupport_runtime.blank?(block.code)
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      begin
        invocation = self.class.invocation_for(block.language)
        command = [invocation.executable, *invocation.arguments, block.code]
        options = {}
        options[:chdir] = config.working_dir unless TextSupport_runtime.blank?(config.working_dir)
        config.env.each { |key, value| options[:unsetenv_others] = false; ENV[key] = value }
        stdout_data, stderr_data, status = Timeout.timeout(config.timeout_ms / 1000.0) { Open3.capture3(*command, **options) }
        ExecutionResult.new(status.exitstatus, truncate(stdout_data, config.max_output_bytes), truncate(stderr_data, config.max_output_bytes), elapsed_ms(started))
      rescue Timeout::Error
        ExecutionResult.new(124, '', "timed out after #{config.timeout_ms}ms", elapsed_ms(started))
      rescue StandardError => error
        ExecutionResult.new(127, '', TextSupport_runtime.empty(error.message), elapsed_ms(started))
      ensure
        config.env.each_key { |key| ENV.delete(key) if !ENV.key?(key) }
      end
    end

    # Executes all code blocks in document order.
    def execute_module(module_value)
      module_value ? module_value.all_code_blocks.map { |block| execute(block) } : []
    end

    # Returns true only for a nonempty result set whose exits are zero.
    def self.all_succeeded?(results)
      values = Array(results)
      !values.empty? && values.all?(&:succeeded?)
    end

    # Counts results by exit code.
    def self.exit_code_counts(results)
      Array(results).each_with_object(Hash.new(0)) { |result, output| output[result.exit_code] += 1 }
    end

    def truncate(value, maximum)
      text = TextSupport_runtime.empty(value)
      text.length <= maximum ? text : "#{text[0, maximum]}...(truncated)"
    end

    def elapsed_ms(started)
      elapsed = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000
      elapsed.positive? ? elapsed.round : 0
    end

    # Resolved process command.
    class Invocation
      attr_reader :executable, :arguments

      # Creates a command and copies arguments.
      def initialize(executable, arguments = [])
        @executable = TextSupport_runtime.empty(executable)
        @arguments = Array(arguments).map(&:to_s).freeze
        freeze
      end
    end

    # Immutable execution controls.
    class ExecutionConfig
      attr_reader :timeout_ms, :env, :working_dir, :max_output_bytes

      # Creates normalized controls.
      def initialize(timeout_ms: 60_000, env: {}, working_dir: nil, max_output_bytes: 1_048_576)
        @timeout_ms = timeout_ms.to_i.positive? ? timeout_ms.to_i : 60_000
        @env = (env || {}).to_h.transform_keys(&:to_s).transform_values(&:to_s).freeze
        @working_dir = TextSupport_runtime.blank?(working_dir) ? nil : working_dir.to_s
        @max_output_bytes = max_output_bytes.to_i.positive? ? max_output_bytes.to_i : 1_048_576
        freeze
      end

      # Returns documented defaults.
      def self.defaults
        new
      end

      # Returns an independent copy.
      def copy
        self.class.new(timeout_ms: timeout_ms, env: env.dup, working_dir: working_dir, max_output_bytes: max_output_bytes)
      end
    end

    # One process result.
    class ExecutionResult
      attr_reader :exit_code, :stdout, :stderr, :duration_ms

      # Creates a normalized result.
      def initialize(exit_code, stdout, stderr, duration_ms)
        @exit_code = exit_code.to_i
        @stdout = TextSupport_runtime.empty(stdout)
        @stderr = TextSupport_runtime.empty(stderr)
        @duration_ms = [duration_ms.to_i, 0].max
        freeze
      end

      # Reports whether the process exited zero.
      def succeeded?
        exit_code.zero?
      end

      # Combines nonempty streams.
      def combined_output
        return stderr if stdout.empty?
        return stdout if stderr.empty?
        "#{stdout}\n#{stderr}"
      end
    end

    # Raised for unsupported languages.
    class ExecutionError < StandardError; end
  end

  module TextSupport_runtime
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
  module UtilitySupport2_runtime
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_runtime.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_runtime.blank?(needle) ? 0 : TextSupport_runtime.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_runtime.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_runtime.empty(value).split("\n").count { |line| !line.strip.empty? }
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
      return [] if TextSupport_runtime.blank?(needle)
      Array(values).select { |value| TextSupport_runtime.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_runtime.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_runtime.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_runtime.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_runtime.normalized(value).split(' ').each do |word|
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
      TextSupport_runtime.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_runtime.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_runtime.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_runtime.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_runtime.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_runtime.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_runtime.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_runtime.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_runtime.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_runtime.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_runtime.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_runtime.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_runtime.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_runtime.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_runtime.blank?(value) ? 'module.mam.md' : TextSupport_runtime.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_runtime.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_runtime.non_blank(TextSupport_runtime.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_runtime.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_runtime.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_runtime.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_runtime.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_runtime.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_runtime.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_runtime.blank?(value)
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
