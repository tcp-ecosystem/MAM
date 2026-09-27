# frozen_string_literal: true

module Mam
  # Bounded thread-safe execution-result cache.
  class ResultCache
    # Creates a cache; nonpositive TTL disables expiry.
    def initialize(ttl_ms = 300_000, capacity = 512)
      @ttl_ms = [ttl_ms.to_i, 0].max
      @capacity = [capacity.to_i, 1].max
      @entries = {}
      @hits = 0
      @misses = 0
      @evictions = 0
      @mutex = Mutex.new
    end

    # Returns a default cache.
    def self.defaults
      new
    end

    # Reads a live result or nil.
    def get(key)
      normalized = self.class.normalize_key(key)
      @mutex.synchronize do
        entry = normalized && @entries[normalized]
        if entry.nil? || expired?(entry)
          @entries.delete(normalized) if normalized
          @misses += 1
          nil
        else
          @hits += 1
          entry[:value]
        end
      end
    end

    # Stores a value and evicts expired or oldest overflow.
    def set(key, value)
      normalized = self.class.normalize_key(key)
      return if normalized.nil? || value.nil?
      now = monotonic_ms
      @mutex.synchronize do
        @entries.delete_if { |_, entry| expired_at?(entry, now) }
        unless @entries.key?(normalized)
          oldest = @entries.min_by { |_, entry| entry[:stored_at] }&.first
          if @entries.length >= @capacity && oldest
            @entries.delete(oldest)
            @evictions += 1
          end
        end
        @entries[normalized] = { value: value, stored_at: now }
      end
      self
    end
    alias put set

    # Returns cached or factory-created result.
    def get_or_set(key)
      existing = get(key)
      return existing unless existing.nil?
      value = yield if block_given?
      set(key, value)
      value
    end

    # Removes one key.
    def delete(key)
      normalized = self.class.normalize_key(key)
      return false unless normalized
      @mutex.synchronize { !@entries.delete(normalized).nil? }
    end
    alias remove delete

    # Clears entries but preserves counters.
    def clear
      @mutex.synchronize { @entries.clear }
      self
    end

    # Removes expired entries and returns their count.
    def prune
      now = monotonic_ms
      @mutex.synchronize do
        expired = @entries.select { |_, entry| expired_at?(entry, now) }.keys
        expired.each { |key| @entries.delete(key) }
        expired.length
      end
    end

    # Returns live entry count.
    def size
      prune
      @mutex.synchronize { @entries.length }
    end

    # Returns counter snapshot.
    def stats
      @mutex.synchronize { CacheStats.new(@hits, @misses, @evictions, @entries.length) }
    end

    # Returns hit rate or zero.
    def hit_rate
      stats.hit_rate
    end

    # Returns live keys in insertion order.
    def keys
      prune
      @mutex.synchronize { @entries.keys.dup }
    end

    # Updates TTL for existing and future entries.
    def ttl=(milliseconds)
      @mutex.synchronize { @ttl_ms = [milliseconds.to_i, 0].max }
    end

    # Updates capacity and evicts oldest overflow.
    def capacity=(value)
      @mutex.synchronize do
        @capacity = [value.to_i, 1].max
        while @entries.length > @capacity
          oldest = @entries.min_by { |_, entry| entry[:stored_at] }.first
          @entries.delete(oldest)
          @evictions += 1
        end
      end
    end

    # Normalizes a cache key or returns nil.
    def self.normalize_key(key)
      return nil if key.nil?
      value = key.to_s.strip
      return nil if value.empty? || value.length > 1024 || value.match?(/[[:cntrl:]]/)
      value
    end

    def expired?(entry)
      expired_at?(entry, monotonic_ms)
    end

    def expired_at?(entry, now)
      @ttl_ms.positive? && now - entry[:stored_at] >= @ttl_ms
    end

    def monotonic_ms
      Process.clock_gettime(Process::CLOCK_MONOTONIC, :millisecond)
    end

    # Cache counter snapshot.
    CacheStats = Struct.new(:hits, :misses, :evictions, :size, keyword_init: true) do
      # Returns hit rate, zero when no lookups occurred.
      def hit_rate
        total = hits.to_i + misses.to_i
        total.zero? ? 0.0 : hits.to_f / total
      end
    end
  end

  module TextSupport_cache
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
  module UtilitySupport2_cache
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_cache.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_cache.blank?(needle) ? 0 : TextSupport_cache.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_cache.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_cache.empty(value).split("\n").count { |line| !line.strip.empty? }
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
      return [] if TextSupport_cache.blank?(needle)
      Array(values).select { |value| TextSupport_cache.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_cache.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_cache.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_cache.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_cache.normalized(value).split(' ').each do |word|
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
      TextSupport_cache.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_cache.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_cache.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_cache.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_cache.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_cache.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_cache.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_cache.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_cache.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_cache.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_cache.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_cache.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_cache.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_cache.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_cache.blank?(value) ? 'module.mam.md' : TextSupport_cache.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_cache.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_cache.non_blank(TextSupport_cache.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_cache.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_cache.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_cache.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_cache.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_cache.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_cache.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_cache.blank?(value)
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
