#!/usr/bin/env python3
"""
patch_overview.py - Patch Cockpit's overview.js.gz to render ANSI colored MOTD via React dangerouslySetInnerHTML
"""

import gzip
import os
import shutil
import subprocess
import sys
import tempfile

OVERVIEW_GZ = "/usr/share/cockpit/systemd/overview.js.gz"
ORIG_GZ = "/usr/share/cockpit/systemd/overview.js.gz.orig"

TARGET = 'title:de.default.createElement("pre",{id:"motd"},e)'

REPLACEMENT = (
    'title:de.default.createElement("pre",{id:"motd",'
    'style:{fontFamily:"var(--pf-t--global--font--family--monospace,monospace)",lineHeight:1.25,overflowX:"auto"},'
    'dangerouslySetInnerHTML:{__html:(()=>{'
    'if(!e)return"";'
    'const c={"30":"#4b5563","31":"#ef4444","32":"#22c55e","33":"#eab308","34":"#3b82f6","35":"#d946ef","36":"#06b6d4","37":"#e5e7eb",'
    '"90":"#9ca3af","91":"#f87171","92":"#4ade80","93":"#fde047","94":"#60a5fa","95":"#f472b6","96":"#38bdf8","97":"#ffffff"};'
    'const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");'
    'let fg=null,bold=false,open=false,out="",last=0;'
    'let s=e.replace(/(?:\\x1b|\\u001b|\\\\e)\\[[0-9;]*[HfABCDJKsu]/g,"").trimEnd();'
    'const re=/(?:\\x1b|\\u001b|\\\\e)\\[([0-9;]*)m|(?:^|\\s)\\[((?:01;|00;)?[0-9]{1,2}(?:;[0-9]{1,2})*)m/g;'
    'let m;'
    'while((m=re.exec(s))!==null){'
    'const chunk=s.slice(last,m.index);'
    'if(chunk)out+=esc(chunk);'
    'last=re.lastIndex;'
    'const cs=m[1]!==undefined?m[1]:m[2];'
    'const codes=cs?cs.split(";").map(Number):[0];'
    'for(const code of codes){'
    'if(isNaN(code)||code===0){fg=null;bold=false;}'
    'else if(code===1){bold=true;}'
    'else if(code===22){bold=false;}'
    'else if(c[String(code)]){fg=c[String(code)];}'
    'else if(code===39){fg=null;}'
    '}'
    'if(open){out+="</span>";open=false;}'
    'const st=[];'
    'if(fg)st.push("color:"+fg);'
    'if(bold)st.push("font-weight:bold");'
    'if(st.length>0){out+="<span style=\\""+st.join(";")+"\\">";open=true;}'
    '}'
    'const rem=s.slice(last);'
    'if(rem)out+=esc(rem);'
    'if(open)out+="</span>";'
    'return out;'
    '})()}})'
)

def patch_overview():
    if not os.path.exists(OVERVIEW_GZ):
        print(f"Error: {OVERVIEW_GZ} does not exist", file=sys.stderr)
        return False

    # 1. Ensure clean backup
    if not os.path.exists(ORIG_GZ):
        shutil.copy2(OVERVIEW_GZ, ORIG_GZ)
        print(f"Backed up clean original to {ORIG_GZ}")

    # Read from original backup to avoid repeated patching
    with gzip.open(ORIG_GZ, "rt", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    if TARGET not in content:
        # Check if already patched
        if "dangerouslySetInnerHTML" in content and "motd" in content:
            print("Already patched!")
            return True
        print(f"Error: Target snippet not found in {ORIG_GZ}", file=sys.stderr)
        return False

    patched_content = content.replace(TARGET, REPLACEMENT)

    # 2. Verify with node -c
    with tempfile.NamedTemporaryFile(suffix=".js", mode="w", encoding="utf-8") as tmp:
        tmp.write(patched_content)
        tmp.flush()
        res = subprocess.run(["node", "-c", tmp.name], capture_output=True, text=True)
        if res.returncode != 0:
            print(f"Error: JavaScript syntax validation failed: {res.stderr}", file=sys.stderr)
            return False

    # 3. Write compressed output
    with tempfile.NamedTemporaryFile(suffix=".gz", delete=False) as tmp_gz:
        tmp_gz_name = tmp_gz.name
        with gzip.open(tmp_gz_name, "wt", encoding="utf-8") as f_out:
            f_out.write(patched_content)

    os.chmod(tmp_gz_name, 0o644)
    shutil.move(tmp_gz_name, OVERVIEW_GZ)
    print(f"Successfully patched {OVERVIEW_GZ} with native React ANSI colorizer!")
    return True

if __name__ == "__main__":
    if not patch_overview():
        sys.exit(1)
