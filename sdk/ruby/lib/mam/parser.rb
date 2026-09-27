# frozen_string_literal: true

module Mam
  require 'yaml'

  # Parses Markdown and YAML front matter using stdlib Psych.
  module Parser
    module_function

    # Parses raw content; malformed front matter or fences return a safe failure hash.
    # Keys are <tt>:success</tt>, <tt>:module</tt>, <tt>:error</tt>, <tt>:line</tt>, and <tt>:column</tt>.
    def safe_parse(content, file_path = '')
      parse(content, file_path)
    rescue StandardError => error
      { success: false, module: nil, error: error.message, line: error.respond_to?(:line) ? error.line : 0, column: 0 }
    end

    # Parses content and returns an Ast::Module.
    def parse(content, file_path = '')
      source = normalize(content)
      lines = source.split("\n", -1)
      cursor = 0
      frontmatter = nil
      if lines.first == '---'
        cursor = 1
        yaml_lines = []
        while cursor < lines.length && lines[cursor] != '---'
          yaml_lines << lines[cursor]
          cursor += 1
        end
        raise ParseError, 'unterminated front matter' if cursor >= lines.length
        cursor += 1
        frontmatter = parse_frontmatter(yaml_lines.join("\n"))
      end
      sections = []
      while cursor < lines.length
        match = /\A(#{1,6})\s+(.+)\z/.match(lines[cursor])
        unless match
          cursor += 1
          next
        end
        title = match[2].strip
        start_line = cursor + 1
        cursor += 1
        body = []
        while cursor < lines.length && !/\A#{1,6}\s+/.match?(lines[cursor])
          body << lines[cursor]
          cursor += 1
        end
        location = Ast::Location.new(line: start_line, column: 1, offset: 0, file_path: file_path.to_s)
        sections << Ast::Section.new(Ast::SectionKind.parse(title), title, parse_content(body, location), location)
      end
      Ast::Module.new(frontmatter: frontmatter, sections: sections, raw_content: source, file_path: file_path.to_s)
    end

    # Parses a UTF-8 file.
    def parse_file(path)
      parse(File.read(path, encoding: 'UTF-8'), path.to_s)
    end

    # Normalizes CRLF and CR line endings and strips a BOM.
    def normalize(content)
      TextSupport_parser.empty(content).sub(/\A\uFEFF/, '').gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Reports whether text begins with a front-matter delimiter.
    def front_matter?(content)
      normalize(content).split("\n", 2).first == '---'
    end

    # Extracts raw YAML without parsing.
    def extract_front_matter(content)
      lines = normalize(content).split("\n", -1)
      return '' unless lines.first == '---'
      output = []
      lines[1..].to_a.each do |line|
        break if line == '---'
        output << line
      end
      output.join("\n")
    end

    # Lists level-two section titles.
    def section_titles(content)
      normalize(content).split("\n").filter_map do |line|
        match = /\A##\s+(.+)\z/.match(line)
        match && match[1].strip
      end
    end

    # Parses a YAML mapping and returns authoritative Ast::FrontMatter fields.
    def parse_front_matter(yaml)
      raw = YAML.safe_load(yaml, permitted_classes: [], permitted_symbols: [], aliases: false) || {}
      raise ParseError, 'front matter must be a mapping' unless raw.is_a?(Hash)
      Ast::FrontMatter.new(
        name: scalar(raw['name']), authors: list(raw['authors']), version: scalar(raw['version']),
        description: scalar(raw['description']), schema_version: scalar(raw['schema_version']),
        license: scalar(raw['license']), tags: list(raw['tags']),
        dependencies: list(raw['dependencies']), metadata: map(raw['metadata'])
      )
    rescue Psych::Exception => error
      raise ParseError, "invalid front matter: #{error.message}"
    end

    def parse_content(lines, location)
      output = []
      index = 0
      while index < lines.length
        line = lines[index]
        if line.strip.start_with?('```')
          language = line.strip[3..].to_s.strip
          code = []
          index += 1
          closed = false
          while index < lines.length
            if lines[index].strip == '```'
              closed = true
              index += 1
              break
            end
            code << lines[index]
            index += 1
          end
          raise ParseError, 'unterminated code fence' unless closed
          output << Ast::CodeBlock.new(language, code.join("\n"), location)
        elsif line.strip.empty?
          index += 1
        else
          paragraph = []
          while index < lines.length && !lines[index].strip.empty? && !lines[index].strip.start_with?('```')
            paragraph << lines[index]
            index += 1
          end
          output << Ast::Paragraph.new(paragraph.join("\n"), location)
        end
      end
      output
    end

    def scalar(value)
      TextSupport_parser.empty(value).strip
    end

    def list(value)
      return value.map(&:to_s) if value.is_a?(Array)
      text = scalar(value)
      text.empty? ? [] : [text]
    end

    def map(value)
      return {} unless value.is_a?(Hash)
      value.to_h { |key, item| [key.to_s, scalar(item)] }
    end

    # Raised for malformed structural input.
    class ParseError < StandardError
      # Returns a one-based line when available.
      attr_reader :line

      # Creates a parse error.
      def initialize(message, line = 0)
        @line = line.to_i
        super(TextSupport_parser.empty(message))
      end
    end
  end

  module TextSupport_parser
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
  module UtilitySupport2_parser
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_parser.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_parser.blank?(needle) ? 0 : TextSupport_parser.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_parser.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_parser.empty(value).split("\n").count { |line| !line.strip.empty? }
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
      return [] if TextSupport_parser.blank?(needle)
      Array(values).select { |value| TextSupport_parser.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_parser.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_parser.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_parser.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_parser.normalized(value).split(' ').each do |word|
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
      TextSupport_parser.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_parser.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_parser.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_parser.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_parser.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_parser.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_parser.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_parser.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_parser.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_parser.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_parser.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_parser.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_parser.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_parser.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_parser.blank?(value) ? 'module.mam.md' : TextSupport_parser.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_parser.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_parser.non_blank(TextSupport_parser.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_parser.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_parser.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_parser.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_parser.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_parser.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_parser.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_parser.blank?(value)
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
