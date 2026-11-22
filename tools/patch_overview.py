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
    'style:{background:"#0a0e17",color:"#f8fafc",padding:"16px 20px",borderRadius:"8px",'
    'border:"1px solid #1e293b",boxShadow:"inset 0 2px 4px rgba(0,0,0,0.5)",'
    'fontFamily:"var(--pf-t--global--font--family--monospace,monospace)",fontSize:"13px",'
    'lineHeight:1.3,overflowX:"auto"},'
    'dangerouslySetInnerHTML:{__html:(()=>{'
    'if(!e)return"";'
    'const c={"30":"#64748b","31":"#f87171","32":"#4ade80","33":"#fbbf24","34":"#60a5fa","35":"#e879f9","36":"#38bdf8","37":"#f1f5f9",'
    '"90":"#94a3b8","91":"#fca5a5","92":"#86efac","93":"#fde047","94":"#93c5fd","95":"#f0abfc","96":"#67e8f9","97":"#ffffff"};'
    'const esc=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");'
    'let s=e.replace(/(?:\\x1b|\\u001b|\\\\e)\\[[0-9;]*[HfABCDJKsu]/g,"").trimEnd();'
    'let fg=null,bold=false,open=false,out="",last=0;'
    'const re=/(?:\\x1b|\\u001b|\\\\e)\\[([0-9;]*)m|(?:^|\\s)\\[((?:01;|00;)?[0-9]{1,2}(?:;[0-9]{1,2})*)m/g;'
    'let m;'
    'while((m=re.exec(s))!==null){'
    'const chunk=s.slice(last,m.index);'
    'if(chunk){'
    'let t=esc(chunk);'
    'if(!fg){'
    't=t.replace(/\\b(running|active|Synchronised|0 failed)\\b/g,"<span style=\\"color:#4ade80!important;font-weight:bold!important\\">$1</span>");'
    't=t.replace(/\\b(degraded|failed|NOT Synchronised)\\b/g,"<span style=\\"color:#f87171!important;font-weight:bold!important\\">$1</span>");'
    '}'
    'out+=t;'
    '}'
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
    'if(fg)st.push("color:"+fg+"!important");'
    'if(bold)st.push("font-weight:bold!important");'
    'if(st.length>0){out+="<span style=\\""+st.join(";")+"\\">";open=true;}'
    '}'
    'const rem=s.slice(last);'
    'if(rem){'
    'let t=esc(rem);'
    'if(!fg){'
    't=t.replace(/\\b(running|active|Synchronised|0 failed)\\b/g,"<span style=\\"color:#4ade80!important;font-weight:bold!important\\">$1</span>");'
    't=t.replace(/\\b(degraded|failed|NOT Synchronised)\\b/g,"<span style=\\"color:#f87171!important;font-weight:bold!important\\">$1</span>");'
    '}'
    'out+=t;'
    '}'
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
