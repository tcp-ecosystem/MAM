# MAM Jupyter Kernel

A minimal Jupyter kernel that executes MAM (Machine Agent Modules) modules.
Each cell is written to a temporary `.mam` file and run through the
[`@mam/cli`](../../../cli) `mam run <file> --format json` command; the JSON
result (or the command's stderr on failure) is streamed back as an execution
result.

## Files

- `kernel.json` — kernel spec (argv launches `python kernel.py -f {connection_file}`)
- `kernel.py` — minimal `ipykernel`-based kernel

## Requirements

- Python 3.8+
- `ipykernel` (`pip install ipykernel`)
- The `@mam/cli` binary on `PATH` (or set `MAM_KERNEL_CLI` to a custom path)

## Install

From this directory:

```bash
jupyter kernelspec install kernel/ --user
```

Verify:

```bash
jupyter kernelspec list
# shows a "mam" kernelspec
```

Then start JupyterLab, create a Notebook, and select the **MAM** kernel.
Type your MAM module in a cell and run it — the output of `mam run` is
returned as the cell result.

## Testing

Launch the kernel directly against a connection file:

```bash
jupyter kernelspec install kernel/ --user
jupyter console --kernel mam
```

Uninstall when no longer needed:

```bash
jupyter kernelspec uninstall mam
```