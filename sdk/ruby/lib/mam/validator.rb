# frozen_string_literal: true

module Mam
  # Extensible validator implementing the shared validation contract.
  class Validator
    # Creates a validator with built-in rules.
    def initialize
      @rules = built_ins
    end

    # Adds a custom rule after built-ins.
    # +id+ must be nonblank and +check+ must respond to <tt>call</tt>.
    def add_rule(id, check)
      raise ArgumentError, 'rule id and check are required' if TextSupport_validator.blank?(id) || !check.respond_to?(:call)
      @rules << [id.to_s, check]
      self
    end

    # Removes rules by identifier and returns the count removed.
    def remove_rule(id)
      before = @rules.length
      @rules.reject! { |rule_id, _| rule_id == id.to_s }
      before - @rules.length
    end

    # Returns rule identifiers in execution order.
    def rule_ids
      @rules.map(&:first)
    end

    # Validates nil safely and returns a ValidationResult.
    def validate(module_value)
      diagnostics = []
      @rules.each do |id, check|
        begin
          Array(check.call(module_value)).each { |diagnostic| diagnostics << normalize(diagnostic) }
        rescue StandardError
          diagnostics << Diagnostic.new(Ast::Severity::INFO, "rule #{id} failed safely", 0, '')
        end
      end
      ValidationResult.new(diagnostics)
    end

    # Returns diagnostics matching +severity+.
    def self.by_severity(result, severity)
      result ? result.diagnostics.select { |item| item.severity == severity } : []
    end

    # Counts diagnostics of +severity+.
    def self.count(result, severity)
      by_severity(result, severity).length
    end

    # Returns ordered diagnostic messages.
    def self.messages(result)
      result ? result.diagnostics.map(&:message) : []
    end

    # Returns diagnostics matching a case-insensitive section name.
    def self.by_section(result, section)
      return [] unless result && section
      result.diagnostics.select { |item| item.section.casecmp?(section.to_s) }
    end

    def built_ins
      [
        ['frontmatter', lambda { |mod| mod && mod.frontmatter ? [] : [error('missing front matter', 1, '')] }],
        ['name', lambda { |mod| mod&.frontmatter && TextSupport_validator.blank?(mod.frontmatter.name) ? [Diagnostic.new(Ast::Severity::WARNING, 'name is recommended', 1, 'metadata')] : [] }],
        ['version', lambda { |mod| mod&.frontmatter && TextSupport_validator.blank?(mod.frontmatter.version) ? [Diagnostic.new(Ast::Severity::WARNING, 'version is recommended', 1, 'metadata')] : [] }],
        ['sections', lambda { |mod| mod.nil? || mod.sections.empty? ? [error('at least one section is required', 1, '')] : [] }],
        ['languages', lambda { |mod| mod ? mod.all_code_blocks.select { |block| TextSupport_validator.blank?(block.language) }.map { |block| Diagnostic.new(Ast::Severity::WARNING, 'code block needs a language', block.location.line, '') } : [] }],
        ['purpose', lambda { |mod| mod && mod.section_by_kind(Ast::SectionKind::PURPOSE).nil? ? [Diagnostic.new(Ast::Severity::INFO, 'purpose section is recommended', 1, '')] : [] }]
      ]
    end

    def error(message, line, section)
      Diagnostic.new(Ast::Severity::ERROR, message, line, section)
    end

    def normalize(value)
      value.is_a?(Diagnostic) ? value : Diagnostic.new(Ast::Severity::INFO, value.to_s, 0, '')
    end

    # One validation diagnostic.
    Diagnostic = Struct.new(:severity, :message, :line, :section, keyword_init: true) do
      # Formats this diagnostic for a terminal.
      def format
        "#{severity} at line #{line}: #{message}"
      end
    end

    # Complete validation result.
    class ValidationResult
      attr_reader :diagnostics

      # Creates a result and computes validity from error presence.
      def initialize(diagnostics = [])
        @diagnostics = Array(diagnostics).freeze
        freeze
      end

      # Returns true only when no error diagnostic exists.
      def is_valid
        diagnostics.none? { |item| item.severity == Ast::Severity::ERROR }
      end
      alias is_valid? is_valid
    end
  end

  module TextSupport_validator
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
  module UtilitySupport2_validator
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_validator.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_validator.blank?(needle) ? 0 : TextSupport_validator.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_validator.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_validator.empty(value).split("\n").count { |line| !line.strip.empty? }
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
      return [] if TextSupport_validator.blank?(needle)
      Array(values).select { |value| TextSupport_validator.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_validator.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_validator.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_validator.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_validator.normalized(value).split(' ').each do |word|
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
      TextSupport_validator.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_validator.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_validator.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_validator.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_validator.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_validator.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_validator.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_validator.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_validator.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_validator.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_validator.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_validator.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_validator.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_validator.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_validator.blank?(value) ? 'module.mam.md' : TextSupport_validator.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_validator.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_validator.non_blank(TextSupport_validator.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_validator.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_validator.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_validator.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_validator.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_validator.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_validator.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_validator.blank?(value)
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
