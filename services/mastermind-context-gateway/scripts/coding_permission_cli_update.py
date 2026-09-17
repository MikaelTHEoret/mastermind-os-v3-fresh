"""Exact second CLI pin; reuse the accepted catalog/CAS/rollback guards."""
import copy
import hashlib
import types

UPDATE_SHA = 'a19e5612b07ccf3a4d005f00e1435851c80240d622f673c601f457df39b98de5'
CLI_SHA = '081e4de4be8e38fac6ed4d95e3b1a0b9f6d31c090ddc36e1696b349fe406f575'

def transition(guards, extension, base, prior, updated):
    original, accepted = extension.reviewed_pair(guards, base, prior)
    if not isinstance(updated,bytes) or hashlib.sha256(updated).hexdigest()!=UPDATE_SHA:
        raise ValueError('CLI_UPDATE_SOURCE_PIN_CHANGED')
    text=updated.decode('utf-8')
    old=guards.reviewed_functions(base)
    if text.count('\nCOMMIT;\n')!=1 or not text.endswith('\nCOMMIT;\n'):
        raise ValueError('CLI_UPDATE_BOUNDARY_CHANGED')
    rows=guards.new_functions(text[:-len('COMMIT;\n')]+old[1]['statement']+'\nCOMMIT;\n',None)
    if rows[1]!=old[1]:raise ValueError('CLI_UPDATE_SETTER_CHANGED')
    expected=accepted['statement'].replace(
        "= '"+extension.CLI_SHA+"'", "IN ('"+extension.CLI_SHA+"', '"+CLI_SHA+"')")
    if expected==accepted['statement'] or rows[0]['statement']!=expected:
        raise ValueError('CLI_UPDATE_ONLY_EXACT_PIN_EXTENSION_ALLOWED')
    rollback=f"s->'runtime'->>'cliProfile'='{extension.PROFILE}' AND s->'runtime'->>'codexSha256'='{CLI_SHA}'"
    return accepted,rows[0],UPDATE_SHA,rollback

def render_disposable(guards, extension, base, prior, updated, action):
    pair=transition(guards,extension,base,prior,updated)
    return extension._render(guards,base,prior,action,
        f"current_setting('{extension.SETTING}',false)::jsonb",reviewed_transition=pair)

def render_canonical(guards, extension, preflight, base, prior, updated, action):
    if not isinstance(preflight,dict) or preflight.get('extensionSha256')!=UPDATE_SHA:
        raise ValueError('CLI_UPDATE_PREFLIGHT_REQUIRED')
    shape=copy.deepcopy(preflight);shape['extensionSha256']=extension.EXTENSION_SHA
    context=guards.json_literal(extension.canonical_context(guards,shape))
    pair=transition(guards,extension,base,prior,updated)
    return extension._render(guards,base,prior,action,context,reviewed_transition=pair)

def fixture_checks(guards, extension, checks, fixture, base, prior, updated):
    """Run the established 17 real SQL controls for the second exact pin."""
    transition(guards,extension,base,prior,updated)
    def render(g,b,u,action):
        if g is not guards or b!=base or u!=updated:raise ValueError('CLI_FIXTURE_INPUT_CHANGED')
        return render_disposable(g,extension,b,prior,u,action)
    adapter=types.SimpleNamespace(render_disposable=render,PROFILE=extension.PROFILE,CLI_SHA=CLI_SHA,SETTER=extension.SETTER,
        fixture_context_capture=extension.fixture_context_capture)
    return checks.compose(guards,adapter,fixture,base,updated)

def insert_fixture(sql, guards, extension, checks, fixture, base, prior, updated):
    rollback=guards.transaction_body(extension.render_disposable(guards,base,prior,'rollback'))
    seam=rollback+rollback
    if sql.count(seam)!=1:raise ValueError('CLI_FIXTURE_ROLLBACK_SEAM_CHANGED')
    added=fixture_checks(guards,extension,checks,fixture,base,prior,updated)
    return sql.replace(seam,added+seam,1)
