-- plugin/mam.lua - MAM (Machine Agent Modules) plugin for Neovim
-- Description: Buffer-local options and a `:MamValidate` command for MAM
--              files. Loaded automatically when filetype=mam is active
--              because it lives in plugin/ (runtime path).
--
--   - Sets sensible buffer options: commentstring, shiftwidth, expandtab,
--     folding for the front matter region.
--   - Registers `:MamValidate` which runs `mam validate` against the current
--     file via vim.fn.system and prints the result (errors to the message
--     area / quickfix).
--
-- Requires: the `mam` CLI on PATH. Install with `pnpm install && pnpm build`
-- in the repo root; the built binary is `packages/cli/bin/mam` (or `mam`).

local M = {}

local MAM_FILETYPES = { 'mam' }

-- ---------------------------------------------------------------------------
-- Buffer options
-- ---------------------------------------------------------------------------
function M.setup_buffer(bufnr)
  bufnr = bufnr or 0

  local buf = vim.api.nvim_buf_set_option

  -- MAM is markdown with HTML comments, mirror the VSCode language-config.
  buf(bufnr, 'commentstring', '<!-- %s -->')

  -- Markdown-flavoured indentation defaults.
  buf(bufnr, 'shiftwidth', 2)
  buf(bufnr, 'tabstop', 2)
  buf(bufnr, 'softtabstop', 2)
  buf(bufnr, 'expandtab', true)
  buf(bufnr, 'autoindent', true)

  -- Fold the YAML front matter region delimited by `---` fence lines.
  -- A small side effect: `---` at the very start of a MAM file (the module
  -- separator, not a horizontal rule) is the only thing we treat specially.
  buf(bufnr, 'foldmethod', 'expr')
  buf(bufnr, 'foldexpr', 'MamFold(v:lnum)')
end

-- ---------------------------------------------------------------------------
-- Fold expression for front matter: lines between the first two `---` fences
-- fold to level 1, everything else is level 0.
--
-- Strategy: count how many `---` fences occur at or before `lnum`.
--   odd count  -> the line is a fence or sits inside the front matter block
--   even count -> the line is a fence or sits after the front matter block
-- This mirrors the folding markers in the VSCode language-config.json
-- ("start": "^---\\s*$", "end": "^---\\s*$").
-- ---------------------------------------------------------------------------
function M.fold(lnum)
  local count = 0
  for i = 1, lnum do
    if vim.fn.getline(i):match('^%-%-%-%s*$') then
      count = count + 1
    end
  end

  local is_fence = vim.fn.getline(lnum):match('^%-%-%-%s*$') ~= nil

  if count % 2 == 1 then
    -- Odd fence count: opening fence or inside the front matter block.
    if is_fence then
      return '>1' -- opening fence -> start of fold level 1
    end
    return '1' -- inside front matter
  end

  -- Even fence count: closing fence or past the front matter block.
  if is_fence then
    return 's1' -- closing fence -> end of fold level 1
  end
  return '0'
end

-- ---------------------------------------------------------------------------
-- :MamValidate - run `mam validate <file>` on the current buffer.
-- ---------------------------------------------------------------------------
function M.validate()
  local filename = vim.fn.expand('%:p')
  if filename == '' then
    vim.api.nvim_err_writeln('MamValidate: buffer has no file name (unsaved file)')
    return false
  end

  -- Run the CLI synchronously and capture both stdout and exit status.
  local out = vim.fn.system({ 'mam', 'validate', filename })
  local ok = vim.v.shell_error == 0

  -- Push messages into the quickfix list when the command produced output,
  -- so failures are easy to jump to.
  local qflist = {}
  for line in out:gmatch('[^\r\n]+') do
    if line ~= '' then
      table.insert(qflist, {
        text = line,
        filename = filename,
        lnum = 0,
        col = 0,
        type = ok and 'I' or 'E',
      })
    end
  end
  if #qflist > 0 then
    vim.fn.setqflist(qflist)
  end

  if ok then
    vim.api.nvim_echo({ { 'mam validate: OK', 'MoreMsg' } }, true, {})
    -- Still surface any informational output (e.g. recommended sections).
    if out ~= '' then
      vim.api.nvim_echo({ { out, 'Comment' } }, false, {})
    end
  else
    local preview = (out:gsub('[\r\n]+', ' | ')):sub(1, 200)
    vim.api.nvim_err_writeln('mam validate failed (see :copen): ' .. preview)
    if vim.fn.exists(':copen') == 2 then
      vim.cmd('copen')
    end
  end
  return ok
end

-- ---------------------------------------------------------------------------
-- Autocommand + command registration (idempotent).
-- ---------------------------------------------------------------------------
function M.setup()
  local augroup = vim.api.nvim_create_augroup('MamPlugin', { clear = true })

  vim.api.nvim_create_autocmd('FileType', {
    group = augroup,
    pattern = MAM_FILETYPES,
    callback = function(args)
      M.setup_buffer(args.buf)
    end,
  })

  -- Register the user command once.
  if vim.fn.exists(':MamValidate') == 0 then
    vim.api.nvim_create_user_command('MamValidate', function()
      M.validate()
    end, {
      desc = 'Run `mam validate` on the current MAM file',
    })
  end
end

-- ---------------------------------------------------------------------------
-- Wire up.
-- ---------------------------------------------------------------------------
M.setup()

-- Export for tests / advanced users.
return M