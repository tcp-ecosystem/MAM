-- ftdetect/mam.lua - Filetype detection for MAM (Markdown as Module) in Neovim
-- Description: Auto-detect MAM files by extension (.mam, .mam.md) and set
--              filetype=mam so the syntax file and plugin load.

local filetype = vim.filetype

-- vim.filetype.add (Neovim 0.8+) is the data-driven way to register filetype
-- detection and is the only method that affects the buffer currently being
-- opened (a plain `autocmd BufRead *.mam ...` in ftdetect/ only fires for
-- *future* buffers).
filetype.add({
  extension = {
    -- Single extension `.mam`: the extension map matches the text after the
    -- final dot, so this covers `foo.mam` (and, incidentally, `foo.MAM`).
    ['mam'] = 'mam',
  },
  pattern = {
    -- Compound extension `.mam.md`: the `extension` map above only ever sees
    -- the last segment (`md`), which the built-in tables resolve to
    -- `markdown`. Register an anchored Lua pattern instead. The key must NOT
    -- carry `^`/`$` anchors - vim.filetype.add wraps user patterns in
    -- `^...$` itself ("user patterns are assumed to be implicitly anchored").
    -- No slash in the pattern, so it is matched against the file "tail".
    ['.*%.mam%.md'] = 'mam',
  },
})

-- For Neovim builds older than 0.8 (pre `vim.filetype.add`), keep a runtime
-- autocommand fallback. It is guarded so it is only created once, and uses
-- `setfiletype` (rather than `set filetype=`) so modelines and user settings
-- win.
if vim.fn.exists('#MamFiletype') == 0 then
  vim.cmd([[
    augroup MamFiletype
      autocmd!
      autocmd BufRead,BufNewFile *.mam,*.mam.md setfiletype mam
    augroup END
  ]])
end

-- Note: `vim.filetype.match` checks patterns (non-negative priority) before
-- it checks extensions, so `.*%.mam%.md` above wins over the built-in
-- `md -> markdown` mapping for `.mam.md` files.
return true