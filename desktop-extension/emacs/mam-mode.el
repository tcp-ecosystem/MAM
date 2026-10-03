;;; mam-mode.el --- Major mode for editing MAM (Machine Agent Modules) -*- lexical-binding: t; -*-

;; Copyright (C) 2026 MAM Desktop Extensions <tcp-ecosystems>

;; Author: MAM Desktop Extensions <tcp-ecosystems>
;; URL: https://github.com/tcp-ecosystems/MAM
;; version: 2.0.0
;; Package-Requires: ((emacs "26.1"))
;; Keywords: languages, markdown, convenience

;; This file is part of the MAM (Machine Agent Modules) desktop extensions.

;;; Commentary:

;; MAM (Machine Agent Modules) is a markdown-based module format with YAML
;; front matter (delimited by `---' fences), `##' section headings, fenced
;; code blocks (including mermaid diagram blocks), tables, blockquotes,
;; lists and inline formatting.
;;
;; This package provides `mam-mode', a full major mode for editing `.mam'
;; and `.mam.md' files.  It implements:
;;
;;   * Font locking (see `mam-font-lock-keywords') for front matter,
;;     headings, code fences, mermaid blocks, lists, tables, blockquotes,
;;     inline formatting and HTML comments.
;;   * A syntax table tuned so MAM punctuation does not confuse Emacs'
;;     syntax machinery.
;;   * `mam-validate', a command that runs the `mam validate' CLI on the
;;     current file (bound to `C-c C-v' in `mam-mode-map').
;;
;; The highlighting rules mirror the canonical TextMate grammar at
;; desktop-extension/vscode/syntaxes/mam.tmLanguage.json.
;;
;; Install by adding this directory to `load-path' and registering the
;; mode on `auto-mode-alist'; see the accompanying README.md for details.

;;; Code:

(require 'cl-lib)

;; ---------------------------------------------------------------------------
;; Syntax table
;; ---------------------------------------------------------------------------

(defvar mam-mode-syntax-table
  (let ((table (make-syntax-table (standard-syntax-table))))
    ;; `#' starts a comment in Lisp dialects; force it to punctuation so
    ;; MAM heading markers and front-matter lines never confuse the syntax
    ;; machinery (font locking is keyword based, but keep the table sane).
    (modify-syntax-entry ?# "." table)
    table)
  "Syntax table used in `mam-mode'.")

;; ---------------------------------------------------------------------------
;; Position predicates (used by the font-lock matchers)
;; ---------------------------------------------------------------------------

(defun mam--line-in-frontmatter-p (pos)
  "Return non-nil if POS lies inside the leading `---' front matter block.
The front matter is the region between the first two `---' fence lines
of the buffer."
  (save-excursion
    (save-restriction
      (widen)
      (goto-char (point-min))
      (when (re-search-forward "^---[ \t]*$" pos t)
        (let ((open-end (match-end 0)))
          ;; If a second fence exists before POS we are past the block.
          (not (re-search-forward "^---[ \t]*$" pos t)))))))

(defun mam--line-in-mermaid-p (pos)
  "Return non-nil if POS lies inside a ```mermaid ... ``` block."
  (save-excursion
    (save-restriction
      (widen)
      (goto-char (point-min))
      (let ((in-mermaid nil))
        ;; Track the *last* fence before POS; a mermaid opener means we are
        ;; inside, a plain ```` ``` ```` close fence means we are outside.
        (while (re-search-forward "^```\\([[:alnum:]]*\\)[ \t]*$" pos t)
          (setq in-mermaid (string= (match-string 1) "mermaid")))
        in-mermaid))))

;; ---------------------------------------------------------------------------
;; Font-lock matcher functions.
;;
;; Each function is invoked by font-lock with LIMIT (the end of the region
;; being highlighted); it must return non-nil and set the match data on
;; success, or return nil.  The functions that span multiple lines let the
;; enclosing keyword `override' the default face so nested constructs are
;; consumed before later, narrower keywords see them.
;; ---------------------------------------------------------------------------

(defun mam--font-lock-fence-block (open-re close-re limit)
  "Match a fenced block from OPEN-RE to CLOSE-RE, bounded by LIMIT.
Sets the match data to span the entire block (open fence, body, close
fence).  An unclosed block matches up to LIMIT."
  (let ((found nil))
    (when (re-search-forward open-re limit t)
      (let ((block-start (match-beginning 0)))
        (if (re-search-forward close-re limit t)
            (set-match-data (list block-start (match-end 0)))
          (set-match-data (list block-start limit)))
        (setq found t)))
    found))

(defun mam--font-lock-mermaid-block (limit)
  "Match a complete ```mermaid ... ``` block up to LIMIT."
  (mam--font-lock-fence-block "^```mermaid[ \t]*$" "^```[ \t]*$" limit))

(defun mam--font-lock-code-block (limit)
  "Match a complete fenced code block up to LIMIT."
  (mam--font-lock-fence-block "^```[[:alnum:]]*[ \t]*$" "^```[ \t]*$" limit))

(defun mam--font-lock-frontmatter-key (limit)
  "Match `key: value' lines, but only inside the front matter."
  (let ((found nil))
    (while (and (not found)
                (re-search-forward
                 "^[ \t]*\\([[:alnum:]_-]+\\)[ \t]*:[ \t]*\\(.*\\)$"
                 limit t))
      (when (mam--line-in-frontmatter-p (point))
        (setq found t)))
    found))

(defun mam--font-lock-heading (limit)
  "Match MAM headings, skipping YAML front matter and code blocks."
  (let ((found nil))
    (while (and (not found)
                (re-search-forward "^\\(#\\{1,6\\}\\)[ \t]*\\(.*\\)$"
                                   limit t))
      (unless (mam--line-in-frontmatter-p (point))
        (setq found t)))
    found))

(defun mam--font-lock-list (limit)
  "Match list markers, skipping YAML front matter."
  (let ((found nil))
    (while (and (not found)
                (re-search-forward "^\\([ \t]*\\)\\([-*+]\\|[0-9]+\\.\\)[ \t]+"
                                   limit t))
      (unless (mam--line-in-frontmatter-p (point))
        (setq found t)))
    found))

(defun mam--font-lock-comment (limit)
  "Match HTML comments `<!-- ... -->' up to LIMIT."
  (let ((found nil))
    (when (re-search-forward "<!--" limit t)
      (let ((start (match-beginning 0)))
        (if (re-search-forward "-->" limit t)
            (set-match-data (list start (match-end 0)))
          (set-match-data (list start limit)))
        (setq found t)))
    found))

;; Regexp for mermaid keywords, precomputed once.
(defvar mam--mermaid-keyword-re
  (regexp-opt '("graph" "flowchart" "sequenceDiagram" "classDiagram"
                "stateDiagram" "erDiagram" "gantt" "journey" "pie")
              'words)
  "Regexp matching mermaid diagram keywords.")

(defun mam--font-lock-mermaid-keyword (limit)
  "Match mermaid keywords, but only inside mermaid blocks."
  (let ((found nil))
    (while (and (not found)
                (re-search-forward mam--mermaid-keyword-re limit t))
      (when (mam--line-in-mermaid-p (point))
        (setq found t)))
    found))

;; ---------------------------------------------------------------------------
;; Customization group
;; ---------------------------------------------------------------------------

(defgroup mam-mode nil
  "Major mode for editing MAM (Machine Agent Modules) files."
  :group 'languages
  :prefix "mam-")

;; ---------------------------------------------------------------------------
;; Faces
;; ---------------------------------------------------------------------------

(defface mam-heading-face
  '((t :inherit (bold font-lock-function-name-face)))
  "Face used for MAM heading text."
  :group 'mam-mode)

(defface mam-mermaid-face
  '((t :inherit font-lock-type-face))
  "Face used for the body of mermaid diagram blocks."
  :group 'mam-mode)

;; ---------------------------------------------------------------------------
;; Font-lock keywords
;;
;; Order matters: block-consuming keywords come first and use `override',
;; so headings/lists/inline rules never fire inside code or mermaid blocks.
;; ---------------------------------------------------------------------------

(defvar mam-font-lock-keywords
  (list
   ;; Mermaid diagram blocks (whole block, overrides everything below).
   '(mam--font-lock-mermaid-block
     (0 'mam-mermaid-face t))
   ;; Generic fenced code blocks (whole block, overrides everything below).
   '(mam--font-lock-code-block
     (0 'font-lock-string-face t))
   ;; Fence delimiters: re-highlight the ```` ``` ```` lines as PreProc even
   ;; though the enclosing block keyword already consumed them.
   '("^```[[:alnum:]]*[ \t]*$" (0 'font-lock-preprocessor-face t))
   ;; Front matter: the `---' fences and the YAML key/value pairs between
   ;; them.
   '("^---[ \t]*$" (0 'font-lock-preprocessor-face))
   '(mam--font-lock-frontmatter-key
     (1 'font-lock-variable-name-face t)
     (2 'font-lock-string-face t))
   ;; Headings (# .. ######), marker vs title.
   '(mam--font-lock-heading
     (1 'font-lock-comment-delimiter-face)
     (2 'mam-heading-face))
   ;; HTML comments.
   '(mam--font-lock-comment
     (0 'font-lock-comment-face t))
   ;; List markers (unordered `-`/`*`/`+` and ordered `1.`).
   '(mam--font-lock-list
     (2 'font-lock-keyword-face))
   ;; Inline formatting: bold, italic, inline code.
   '("\\*\\*\\([^*\n]+\\)\\*\\*" (1 'bold))
   '("\\*\\([^*\n]+\\)\\*" (0 'italic))
   '("\\(`\\)\\([^`\n]+\\)\\(`\\)"
     (1 'font-lock-delimiter-face)
     (2 'font-lock-string-face))
   ;; Markdown links: [text](url).
   '("\\[\\([^]]+\\)\\](\\([^)]+\\))"
     (1 'underline)
     (2 'font-lock-string-face))
   ;; Flow operators (-> => --> etc.).  The canonical grammar highlights
   ;; these everywhere, so no block scoping is needed.
   '("\\(-->\\)\\|\\(==>\\)\\|\\(->\\)\\|\\(=>\\)"
     (0 'font-lock-builtin-face))
   ;; Mermaid keywords, scoped to mermaid blocks.
   '(mam--font-lock-mermaid-keyword
     (0 'font-lock-keyword-face t)))
  "Font lock keywords for `mam-mode'.")

;; ---------------------------------------------------------------------------
;; Commands
;; ---------------------------------------------------------------------------

(defun mam-validate ()
  "Validate the MAM module in the current buffer.

Runs the `mam validate FILE' CLI command and shows its output in the
buffer `*mam-validate*'.  Requires the `mam' binary to be installed
and reachable on `exec-path'."
  (interactive)
  (let* ((file (buffer-file-name))
         (outbuf (get-buffer-create "*mam-validate*")))
    (if (null file)
        (user-error "MAM: buffer is not visiting a file")
      ;; `special-mode' makes the buffer read-only; drop that flag before
      ;; `shell-command' inserts fresh output on repeat invocations.
      (with-current-buffer outbuf
        (setq buffer-read-only nil))
      (shell-command (concat "mam validate "
                             (shell-quote-argument file))
                     outbuf)
      (with-current-buffer outbuf
        (unless (derived-mode-p 'special-mode)
          (special-mode))
        (setq buffer-read-only t))
      (display-buffer outbuf))))

;; ---------------------------------------------------------------------------
;; Keymap
;; ---------------------------------------------------------------------------

(defvar mam-mode-map
  (let ((map (make-sparse-keymap)))
    (define-key map (kbd "C-c C-v") #'mam-validate)
    map)
  "Keymap used in `mam-mode'.")

;; ---------------------------------------------------------------------------
;; The major mode
;; ---------------------------------------------------------------------------

;;;###autoload
(define-derived-mode mam-mode text-mode "MAM"
  "Major mode for editing MAM (Machine Agent Modules) files.

MAM is markdown-based, with YAML front matter delimited by `---'
fences, `##' section headings, fenced code blocks (including mermaid
diagrams), tables, blockquotes, lists and inline formatting.

Font locking covers front matter, headings, code fences, mermaid
blocks, lists, links, inline formatting and HTML comments.  Run
`\\[mam-validate]' to validate the module against the `mam' CLI.

\\{mam-mode-map}"
  :syntax-table mam-mode-syntax-table

  ;; Keyword-based font locking.  The second element (t) makes the
  ;; highlighting keywords-only so the syntax table is never asked to
  ;; find strings/comments (MAM is not Lisp).
  (setq-local font-lock-defaults '(mam-font-lock-keywords t nil))

  ;; MAM uses HTML-style comments, mirroring the VSCode language config.
  (setq-local comment-start "<!--")
  (setq-local comment-end "-->")
  (setq-local comment-start-skip "<!--\\s-*")
  (setq-local comment-end-skip "\\s-*-->")

  ;; Indentation: MAM is written with 2-space indentation, no tabs.
  (setq-local indent-tabs-mode nil)
  (setq-local tab-width 2)

  ;; Outline minor mode works over `#'/`##' headings.
  (setq-local outline-regexp "^#+[ \t]+")

  ;; Imenu menu over section headings.
  (setq-local imenu-generic-expression
              '(("Headings" "^#+[ \t]+\\(.*\\)$" 1)))

  ;; Column used by `fill-paragraph'.
  (setq-local fill-column 80))

;; ---------------------------------------------------------------------------
;; End of file
;; ---------------------------------------------------------------------------

(provide 'mam-mode)

;;; mam-mode.el ends here