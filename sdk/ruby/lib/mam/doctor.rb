# frozen_string_literal: true

require 'tmpdir'
module Mam
  # Non-destructive Ruby SDK environment checks.
  module Doctor
    module Status
      PASS = 'pass'
      WARN = 'warn'
      FAIL = 'fail'
      ALL = [PASS, WARN, FAIL].freeze
    end

    module_function

    # Runs stable environment checks.
    def run(work_dir = nil)
      [ruby_runtime, readable_directory(work_dir), temp_directory, config_presence(work_dir), gem_presence]
    end

    # Checks Ruby 3.0 or newer.
    def ruby_runtime
      major = RUBY_VERSION.split('.').first.to_i
      result('ruby-runtime', major >= 3 ? Status::PASS : Status::FAIL, "Ruby #{RUBY_VERSION}")
    end

    # Checks a readable directory.
    def readable_directory(directory)
      pass = !TextSupport_doctor.blank?(directory) && File.directory?(directory)
      result('work-dir', pass ? Status::PASS : Status::FAIL, pass ? directory : 'directory is missing or unreadable')
    end

    # Formats checks and a status summary.
    def format(results)
      values = Array(results)
      return 'no diagnostic checks' if values.empty?
      output = values.map { |item| "[#{item[:status]}] #{item[:name]}: #{item[:message]}" }.join("\n")
      counts = counts(values)
      output + "\n#{counts[Status::PASS]} passed, #{counts[Status::WARN]} warnings, #{counts[Status::FAIL]} failed"
    end

    # Reports whether any check failed.
    def failures?(results)
      Array(results).any? { |item| item[:status] == Status::FAIL }
    end

    # Counts statuses with zero defaults.
    def counts(results)
      output = Status::ALL.to_h { |status| [status, 0] }
      Array(results).each { |item| output[item[:status]] = output.fetch(item[:status], 0) + 1 }
      output
    end

    # Filters checks by status.
    def by_status(results, status)
      Array(results).select { |item| item[:status] == status }
    end

    # Returns failed check names.
    def failed_names(results)
      by_status(results, Status::FAIL).map { |item| item[:name] }
    end

    def temp_directory
      path = Dir.tmpdir
      pass = File.directory?(path)
      result('temp-dir', pass ? Status::PASS : Status::WARN, path)
    rescue StandardError => error
      result('temp-dir', Status::WARN, error.message)
    end

    def config_presence(work_dir)
      return result('sdk-config', Status::WARN, 'no working directory supplied') if TextSupport_doctor.blank?(work_dir)
      path = Config.resolve_path(work_dir)
      return result('sdk-config', Status::WARN, 'config not found') unless File.file?(path)
      problems = Config.validate(Config.load(path))
      result('sdk-config', problems.empty? ? Status::PASS : Status::FAIL, problems.empty? ? path : problems.join('; '))
    rescue StandardError => error
      result('sdk-config', Status::FAIL, error.message)
    end

    def gem_presence
      pass = !TextSupport_doctor.blank?(ENV['GEM_HOME'] || ENV['GEM_PATH'])
      result('gem-env', pass ? Status::PASS : Status::WARN, pass ? 'gem environment configured' : 'gem environment not configured')
    end

    def result(name, status, message)
      { name: TextSupport_doctor.empty(name), status: status, message: TextSupport_doctor.empty(message) }.freeze
    end
  end

  module TextSupport_doctor
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
  module UtilitySupport2_doctor
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_doctor.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_doctor.blank?(needle) ? 0 : TextSupport_doctor.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_doctor.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_doctor.empty(value).split("\n").count { |line| !line.strip.empty? }
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
      return [] if TextSupport_doctor.blank?(needle)
      Array(values).select { |value| TextSupport_doctor.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_doctor.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_doctor.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_doctor.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_doctor.normalized(value).split(' ').each do |word|
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
      TextSupport_doctor.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_doctor.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_doctor.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_doctor.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_doctor.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_doctor.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_doctor.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_doctor.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_doctor.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_doctor.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_doctor.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_doctor.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_doctor.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_doctor.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_doctor.blank?(value) ? 'module.mam.md' : TextSupport_doctor.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_doctor.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_doctor.non_blank(TextSupport_doctor.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_doctor.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_doctor.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_doctor.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_doctor.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_doctor.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_doctor.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_doctor.blank?(value)
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
