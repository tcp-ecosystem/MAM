# frozen_string_literal: true

module Mam
  # AST value objects and shared module vocabulary.
  module Ast
    # Source position; line and column are one-based when known.
    Location = Struct.new(:line, :column, :offset, :file_path, keyword_init: true) do
      # Formats a path-qualified location.
      def format
        prefix = TextSupport_ast.blank?(file_path) ? 'line ' : "#{file_path}:"
        "#{prefix}#{line}:#{column}"
      end
    end

    # Validation diagnostic severity.
    module Severity
      ERROR = 'error'
      WARNING = 'warning'
      INFO = 'info'
      ALL = [ERROR, WARNING, INFO].freeze

      module_function

      # Returns a known severity or nil.
      def parse(value)
        ALL.find { |item| item == TextSupport_ast.empty(value).downcase }
      end
    end

    # Nineteen standard section kinds plus custom.
    module SectionKind
      METADATA = 'metadata'
      PURPOSE = 'purpose'
      INPUTS = 'inputs'
      OUTPUTS = 'outputs'
      RULES = 'rules'
      WORKFLOW = 'workflow'
      MERMAID = 'mermaid'
      PYTHON = 'python'
      PROMPT = 'prompt'
      MEMORY = 'memory'
      EXAMPLES = 'examples'
      TESTS = 'tests'
      REFERENCES = 'references'
      DEPENDENCIES = 'dependencies'
      EXPORTS = 'exports'
      IMPORTS = 'imports'
      PLUGINS = 'plugins'
      PERMISSIONS = 'permissions'
      CAPABILITIES = 'capabilities'
      CUSTOM = 'custom'
      STANDARD = [METADATA, PURPOSE, INPUTS, OUTPUTS, RULES, WORKFLOW, MERMAID, PYTHON, PROMPT,
                  MEMORY, EXAMPLES, TESTS, REFERENCES, DEPENDENCIES, EXPORTS, IMPORTS,
                  PLUGINS, PERMISSIONS, CAPABILITIES].freeze
      ALL = (STANDARD + [CUSTOM]).freeze

      module_function

      # Parses standard names case-insensitively and returns custom otherwise.
      def parse(value)
        normalized = TextSupport_ast.empty(value).strip.downcase
        STANDARD.include?(normalized) ? normalized : CUSTOM
      end
    end

    # Common contract for content nodes.
    module ContentNode
      # Returns a plain-text projection.
      def text
        raise NotImplementedError
      end
    end

    # Content-node value classes.
    class Value
      include ContentNode
      attr_reader :location

      # Creates a value node at +location+.
      def initialize(location = nil)
        @location = location || Location.new(line: 0, column: 0, offset: 0, file_path: '')
      end
    end

    # Markdown heading node.
    class Heading < Value
      attr_reader :level

      # Creates a heading; invalid levels become six.
      def initialize(text, location = nil, level: 2)
        @text = TextSupport_ast.empty(text)
        @level = level.to_i.between?(1, 6) ? level.to_i : 6
        super(location)
      end

      # Returns heading text.
      attr_reader :text
    end

    # Markdown paragraph node.
    class Paragraph < Value
      # Creates a paragraph from +value+.
      def initialize(value, location = nil)
        @value = TextSupport_ast.empty(value)
        super(location)
      end

      # Returns paragraph text.
      attr_reader :value
      alias text value
    end

    # Fenced code block node.
    class CodeBlock < Value
      attr_reader :language, :code

      # Creates a code block with explicit language and code.
      def initialize(language, code, location = nil)
        @language = TextSupport_ast.empty(language)
        @code = TextSupport_ast.empty(code)
        super(location)
      end

      # Returns code text.
      alias text code
    end

    # Markdown list node.
    class List < Value
      attr_reader :items, :ordered

      # Creates a list and defensively copies items.
      def initialize(items = [], location = nil, ordered: false)
        @items = Array(items).map { |item| TextSupport_ast.empty(item) }.freeze
        @ordered = !!ordered
        super(location)
      end

      # Returns joined item text.
      def text
        items.join("\n")
      end
    end

    # Markdown table node.
    class Table < Value
      attr_reader :headers, :rows

      # Creates a table and deep-copies rows.
      def initialize(headers, rows, location = nil)
        @headers = Array(headers).map { |item| TextSupport_ast.empty(item) }.freeze
        @rows = Array(rows).map { |row| Array(row).map { |item| TextSupport_ast.empty(item) }.freeze }.freeze
        super(location)
      end

      # Returns a plain-text table.
      def text
        ([headers] + rows).map { |row| row.join(' | ') }.join("\n")
      end
    end

    # Markdown blockquote node.
    class Blockquote < Value
      attr_reader :lines

      # Creates a blockquote and copies lines.
      def initialize(lines = [], location = nil)
        @lines = Array(lines).map { |item| TextSupport_ast.empty(item) }.freeze
        super(location)
      end

      # Returns joined quote lines.
      def text
        lines.join("\n")
      end
    end

    # Horizontal-rule node.
    class HorizontalRule < Value
      # Returns canonical rule text.
      def text
        '---'
      end
    end

    # Markdown link node.
    class Link < Value
      attr_reader :label, :url

      # Creates a link with label and URL.
      def initialize(label, url, location = nil)
        @label = TextSupport_ast.empty(label)
        @url = TextSupport_ast.empty(url)
        super(location)
      end

      # Returns label or URL when label is empty.
      def text
        label.empty? ? url : label
      end
    end

    # Markdown image node.
    class Image < Value
      attr_reader :alt, :url

      # Creates an image with alt text and URL.
      def initialize(alt, url, location = nil)
        @alt = TextSupport_ast.empty(alt)
        @url = TextSupport_ast.empty(url)
        super(location)
      end

      # Returns alt text.
      def text
        alt
      end
    end

    # Plain text node.
    class Text < Value
      attr_reader :value

      # Creates a text node.
      def initialize(value, location = nil)
        @value = TextSupport_ast.empty(value)
        super(location)
      end

      # Returns text value.
      alias text value
    end

    # Authoritative front-matter fields.
    class FrontMatter
      attr_reader :name, :authors, :version, :description, :schema_version, :license,
                  :tags, :dependencies, :metadata

      # Creates front matter and defensively copies collections.
      def initialize(name: nil, authors: [], version: nil, description: nil, schema_version: nil,
                     license: nil, tags: [], dependencies: [], metadata: {})
        @name = TextSupport_ast.empty(name)
        @authors = Array(authors).map(&:to_s).freeze
        @version = TextSupport_ast.empty(version)
        @description = TextSupport_ast.empty(description)
        @schema_version = TextSupport_ast.empty(schema_version)
        @license = TextSupport_ast.empty(license)
        @tags = Array(tags).map(&:to_s).freeze
        @dependencies = Array(dependencies).map(&:to_s).freeze
        @metadata = (metadata || {}).to_h.transform_values(&:to_s).freeze
        freeze
      end
    end

    # Parsed section value.
    class Section
      attr_reader :kind, :title, :content, :location

      # Creates a section and defensively copies content.
      def initialize(kind, title, content = [], location = nil)
        @kind = SectionKind.parse(kind)
        @title = TextSupport_ast.empty(title)
        @content = Array(content).freeze
        @location = location || Location.new(line: 0, column: 0, offset: 0, file_path: '')
        freeze
      end

      # Returns direct code blocks.
      def code_blocks
        content.grep(CodeBlock)
      end
    end

    # Parsed module root.
    class Module
      attr_reader :frontmatter, :sections, :raw_content, :file_path

      # Creates a module and defensively copies sections.
      def initialize(frontmatter: nil, sections: [], raw_content: '', file_path: '')
        @frontmatter = frontmatter
        @sections = Array(sections).freeze
        @raw_content = TextSupport_ast.empty(raw_content)
        @file_path = TextSupport_ast.empty(file_path)
        freeze
      end

      # Returns all code blocks in document order.
      def all_code_blocks
        sections.flat_map(&:code_blocks)
      end

      # Returns the first matching section.
      def section_by_kind(kind)
        sections.find { |section| section.kind == SectionKind.parse(kind) }
      end

      # Returns distinct languages in first-seen order.
      def code_block_languages
        all_code_blocks.map { |block| block.language.downcase }.uniq
      end

      # Returns a display name with a stable fallback.
      def display_name
        TextSupport_ast.blank?(frontmatter&.name) ? 'untitled' : frontmatter.name
      end
    end
  end

  module TextSupport_ast
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
  module UtilitySupport2_ast
    module_function

    # Returns a fallback for blank text.
    def default_text(value, fallback)
      TextSupport_ast.blank?(value) ? fallback : value.to_s
    end

    # Counts non-overlapping needle occurrences.
    def count(value, needle)
      TextSupport_ast.blank?(needle) ? 0 : TextSupport_ast.empty(value).scan(Regexp.new(Regexp.escape(needle.to_s))).length
    end

    # Counts physical lines.
    def line_count(value)
      TextSupport_ast.empty(value).split("\n", -1).length
    end

    # Counts nonblank lines.
    def non_empty_line_count(value)
      TextSupport_ast.empty(value).split("\n").count { |line| !line.strip.empty? }
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
      return [] if TextSupport_ast.blank?(needle)
      Array(values).select { |value| TextSupport_ast.empty(value).include?(needle.to_s) }
    end

    # Returns sorted values.
    def sorted(values)
      Array(values).map(&:to_s).sort
    end

    # Returns compact values.
    def compact(values)
      TextSupport_ast.non_blank(values)
    end

    # Removes an exact value.
    def without(values, unwanted)
      Array(values).reject { |value| value == unwanted }
    end

    # Removes blanks.
    def without_blanks(values)
      Array(values).reject { |value| TextSupport_ast.blank?(value) }
    end

    # Joins or returns a fallback.
    def join_or(values, separator, fallback)
      values = Array(values)
      values.empty? ? fallback : values.join(separator.to_s)
    end

    # Indents nonblank lines.
    def indent_lines(value, prefix)
      TextSupport_ast.empty(value).split("\n").map { |line| line.empty? ? line : "#{prefix}#{line}" }.join("\n")
    end

    # Wraps text at an approximate width.
    def wrap(value, width)
      lines = []
      current = +''
      TextSupport_ast.normalized(value).split(' ').each do |word|
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
      TextSupport_ast.empty(value).tr(',', ';').tr("\n", ' ')
    end

    # Wraps text in brackets.
    def bracket(value)
      "[#{TextSupport_ast.empty(value)}]"
    end

    # Wraps text in parentheses.
    def paren(value)
      "(#{TextSupport_ast.empty(value)})"
    end

    # Wraps text in braces.
    def braces(value)
      "{#{TextSupport_ast.empty(value)}}"
    end

    # Escapes a quote.
    def quote(value)
      TextSupport_ast.empty(value).gsub('"', '\\"')
    end

    # Removes matching simple quotes.
    def unquote(value)
      text = TextSupport_ast.empty(value)
      text.length >= 2 && ['"', "'"].include?(text[0]) && text[-1] == text[0] ? text[1..-2] : text
    end

    # Reports whether any value is blank.
    def any_blank?(values)
      values.nil? || Array(values).any? { |value| TextSupport_ast.blank?(value) }
    end

    # Reports whether all values are blank.
    def all_blank?(values)
      values.nil? || Array(values).all? { |value| TextSupport_ast.blank?(value) }
    end

    # Case-insensitive membership check.
    def contains_ignore_case?(values, needle)
      !TextSupport_ast.blank?(needle) && Array(values).any? { |value| value.to_s.casecmp?(needle.to_s) }
    end

    # Checks a language tag.
    def valid_language?(value)
      !TextSupport_ast.blank?(value) && /\A[A-Za-z0-9_+-]+\z/.match?(value)
    end

    # Checks a simple URL.
    def valid_url?(value)
      value.to_s.match?(Regexp.new('\Ahttps?://'))
    end

    # Checks a path without NUL bytes.
    def valid_path?(value)
      !TextSupport_ast.blank?(value) && !value.to_s.include?("\0")
    end

    # Normalizes a language label.
    def normalize_language(value)
      TextSupport_ast.blank?(value) ? 'unknown' : value.to_s.strip.downcase
    end

    # Normalizes a section label.
    def normalize_section(value)
      TextSupport_ast.blank?(value) ? 'custom' : value.to_s.strip.downcase
    end

    # Normalizes a version label.
    def normalize_version(value)
      text = TextSupport_ast.empty(value).strip
      text.empty? ? '0.0.0' : text.sub(/\Av/i, '')
    end

    # Makes a conservative file name.
    def safe_file_name(value)
      TextSupport_ast.blank?(value) ? 'module.mam.md' : TextSupport_ast.file_name(value).gsub(/[^A-Za-z0-9._-]/, '_')
    end

    # Returns a normalized extension.
    def extension_or_unknown(value)
      extension = TextSupport_ast.extension(value)
      extension.empty? ? 'unknown' : extension.downcase
    end

    # Splits a comma-separated string.
    def split_csv(value)
      TextSupport_ast.non_blank(TextSupport_ast.empty(value).split(','))
    end

    # Joins CSV values.
    def join_csv(values)
      Array(values).join(',')
    end

    # Normalizes newlines.
    def replace_newlines(value)
      TextSupport_ast.empty(value).gsub("\r\n", "\n").tr("\r", "\n")
    end

    # Removes matching outer quotes.
    def strip_quotes(value)
      TextSupport_ast.empty(value).sub(Regexp.new("\\A[\"']"), '').sub(Regexp.new("['\"]\\z"), '')
    end

    # Capitalizes text.
    def to_title(value)
      TextSupport_ast.capitalize(value)
    end

    # Shortens text.
    def shorten(value, maximum)
      TextSupport_ast.truncate(value, maximum)
    end

    # Converts nil to an empty string.
    def value_or_empty(value)
      value.nil? ? '' : value.to_s
    end

    # Returns safe text length.
    def safe_length(value)
      TextSupport_ast.empty(value).length
    end

    # Case-insensitive equality.
    def same?(left, right)
      TextSupport_ast.equal_ignore_case?(left, right)
    end

    # Reports whether a value is present.
    def present?(value)
      !TextSupport_ast.blank?(value)
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
