" ftdetect/mam.vim - Filetype detection for MAM (Markdown as Module)
" Language:    MAM
" Description: Auto-detect MAM files by extension (.mam, .mam.md) and set
"              filetype=mam so syntax/mam.vim loads automatically.
"
" The `setfiletype` command only sets the filetype if none has been chosen
" yet (by a previous autocommand or a modeline), which is the polite way to
" avoid stomping on user configuration.
"
" Note: `*.mam.md` is a compound extension; Vim matches `*.mam.md` literally
" as a suffix, so this pattern covers both plain `.mam` and the `.mam.md`
" variant.

" Match by extension.
autocmd BufRead,BufNewFile *.mam            setfiletype mam
autocmd BufRead,BufNewFile *.mam.md         setfiletype mam

" Re-source on OptionSet is unnecessary for a pure filetype setup; the two
" lines above are sufficient for interactive and `vim -c` use alike.