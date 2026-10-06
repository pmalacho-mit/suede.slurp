# suede.slurp

Slurp (<ins style="color:white"><span style="color:#aa1e1e">**S**</span><sub>_ve_</sub><span style="color:#aa1e1e">**l**</span><sub>_te_</sub> <span style="color:#aa1e1e">**ur**</span><sub>_l_</sub> <span style="color:#aa1e1e">**p**</span><sub>_arameterizer_</sub></ins>)

This repo is a [suede dependency](https://github.com/pmalacho-mit/suede).

To see the installable source code, please checkout the [release branch](https://github.com/pmalacho-mit/suede.slurp/tree/release).

What it must do, and the tests that show it does, is in [REQUIREMENTS.md](REQUIREMENTS.md).

## Installation

```bash
bash <(curl -fsSL https://suede.sh/install/release) --repo pmalacho-mit/suede.slurp
```

Run it where you want the dependency. It installs `./suede.slurp`, stages it, and prints what
else (if anything) has to be installed beside it.

<details>
<summary>
See alternative to using <a href="https://github.com/pmalacho-mit/suede#suedesh">suede.sh</a> script proxy
</summary>

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pmalacho-mit/suede/refs/heads/main/scripts/install/release.sh) --repo pmalacho-mit/suede.slurp
```

</details>
