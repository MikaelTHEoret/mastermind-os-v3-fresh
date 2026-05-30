import os, json, re

ROOT = r"C:\Users\Mik\Documents\Claude-system\Documents"

# Third-party/cloned repos and tool dirs — NOT our original work. Skip entirely.
SKIP_DIRS = {
    'node_modules','.git','.next','.venv','__pycache__','dist','build','.gradle',
    'NVIDIA Corporation','PcmHammer-2.00-Preview','Tunerpro bins','Visual Studio 2022',
    'META-INF','assets','generated_images','static','.serena','.vscode',
    'cleanup_backup','old.next','backups','processing_logs','real_processing_logs',
    'nexus_core_processing','logs','minecraft-crossplay-server',
    # cloned third-party repos:
    'AutoGPT-master','astra-db-mcp-main','DeepSeek-V3-main','keepassx-master',
    'ccxt-master','intelligent-trading-bot-master','langchain-mcp-adapters',
    'foundry-mcp-master','mcp-blockchain-server-main','metatool-app-main',
    'mcp-server-stability-ai','pinata-mcp-main','wolframalpha-llm-mcp',
    'openapi-mcp-server','mcp-gateway','servers-main','meteor-ai-complete',
    'meteor-ai-fixed.tar','files_4','de','org','meteordevelopment','components',
    'file_storage','build','data_input','nexus_storage','test_output',
    'gui-enhancement-tools','MCP-Demo','Cline','GitHub','usb-auth','wolfram-demo',
    'toroidal-field-viz','TheoFace_v1','consciousness-enhanced-app',
    'consciousness-enhanced-electron-gui','consciousness-enhanced-terminal',
    'electron-gui','nexus-enhanced','prime','conngpt','Codex','CodexOfHarmonicUnity',
    'Physics-Codex','PhysicsCodex','test-codex-clone','Discovery_Events',
    'NVIDIA Corporation','node_modules',
}

# What we WANT: conversation transcripts, design docs, our memory/architecture work
TEXT_EXT = {'.md','.txt','.py','.js','.json'}
SKIP_EXT = {'.exe','.dll','.bin','.pdb','.png','.jpg','.jpeg','.gif','.webp','.pdf','.zip','.tar','.gz',
            '.ico','.mcworld','.jar','.hprof','.lock','.pkl','.csv','.aux','.toc','.out','.log',
            '.spec','.cff','.toml','.xsd','.properties','.tex','.html','.css','.tsx','.ts','.jsx',
            '.bat','.sh','.yaml','.yml','.sql'}

MAX_SIZE = 1_500_000
MIN_SIZE = 200

# Filename signals that this is OUR work (transcripts, designs, memory architecture)
PRIORITY_HINTS = re.compile(r'readme|memory|fractal|journey|reconstruction|architecture|'
    r'design|protocol|nexus|mirror|core|checkpoint|session|conversation|chat|context|'
    r'plane|knowledge|harmonic|truth|encoding|status|integration|complete|summary|'
    r'mastermind|codex|scroll|breath|vortex|prime|error|best', re.IGNORECASE)

# Repos that ARE our work (keep these even though they're project dirs)
KEEP_PROJECT_DIRS = {'nexus-enhanced-unified','mirror-core-mcp','letta-memory-system',
                     'checkpoint_system','Scroll-Protocol-Invocation'}

to_index = []
priority = []
categories = {}
total_chars = 0

for dirpath, dirs, files in os.walk(ROOT):
    # Allow KEEP dirs even if a parent rule would skip; otherwise apply SKIP
    parts = set(dirpath.split(os.sep))
    in_keep = bool(parts & KEEP_PROJECT_DIRS)
    if not in_keep:
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
    else:
        dirs[:] = [d for d in dirs if d not in {'node_modules','.git','__pycache__','.venv'} and not d.startswith('.')]

    for fn in files:
        ext = os.path.splitext(fn)[1].lower()
        if ext in SKIP_EXT or ext not in TEXT_EXT: continue
        fp = os.path.join(dirpath, fn)
        try: sz = os.path.getsize(fp)
        except: continue
        if sz < MIN_SIZE or sz > MAX_SIZE: continue

        # For .py/.js, only keep if in a KEEP project dir (our memory-system code) OR filename signals our work
        if ext in {'.py','.js'} and not in_keep and not PRIORITY_HINTS.search(fn):
            continue
        # For .json, skip package files and configs
        if ext == '.json' and fn.lower() in ('package.json','package-lock.json','tsconfig.json',
            'components.json','glama.json','vitest.config.json','.eslintrc.json'):
            continue

        categories[ext] = categories.get(ext, 0) + 1
        to_index.append(fp)
        total_chars += sz
        if PRIORITY_HINTS.search(fn) or in_keep:
            priority.append(fp)

print(f"FILES TO INDEX: {len(to_index)}  (of which {len(priority)} are high-priority our-work)")
print(f"Approx chars: {total_chars:,} (~{total_chars//1500:,} chunks)")
print(f"\nBy extension:")
for ext, n in sorted(categories.items(), key=lambda x:-x[1]):
    print(f"  {ext:8} {n}")

with open(r"C:\Users\Mik\Documents\mastermind-client\data\index-filelist.json","w",encoding='utf-8') as f:
    json.dump(to_index, f)
print("\nDONE")
