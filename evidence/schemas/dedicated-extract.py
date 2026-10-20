"""Rebuild deliberately partial source-derived JSON Schema; no network, credentials or dependencies."""
from pathlib import Path
import re, json, hashlib
ROOT = Path(__file__).parent
SETS = [('dedicated', 'dedicated-go-inference_sdk.go', ['ModelSupportedQuantization','EndpointPrivateNetworkDetails','EndpointPublicNetworkDetails','ModelSupportedNode','DeploymentQuantization','Endpoint','ModelSupportInfo','Deployment','Model','NodeType','ListDeploymentsResponse','ListModelsResponse','ListNodeTypesResponse']), ('projects','projects-go-account_sdk.go',['Project','ListProjectsResponse'])]
for prefix, filename, types in SETS:
    source = (ROOT / filename).read_text()
    def shape(t):
        if t.startswith('[]'): return {'type':'array','items':shape(t[2:])}
        if t.startswith('*'): return {'anyOf':[shape(t[1:]), {'type':'null'}]}
        if t == 'string': return {'type':'string'}
        if t == 'bool': return {'type':'boolean'}
        if t in ['uint32','uint64','int32','int64','int']: return {'type':'integer', **({'minimum':0} if t.startswith('uint') else {})}
        if t == 'time.Time': return {'type':'string','format':'date-time'}
        if t == 'scw.Region': return {'type':'string','description':'Generic SDK region type, not product availability.'}
        if t in types: return {'$ref':'#/$defs/'+t}
        match = re.search(r'type '+re.escape(t)+r' string\n\nconst \(.*?\n\)', source, re.S)
        if match:
            values = re.findall(re.escape(t)+r'\("([^"]+)"\)', match[0])
            return {'type':'string','enum':values,'description':'Known values at source revision; future values may exist.'}
        return {'description':'Unexpanded SDK type '+t+'; intentionally unconstrained.'}
    defs = {}
    for t in types:
        match = re.search(r'type '+re.escape(t)+r' struct\s*\{(.*?)\n?\}',source,re.S)
        assert match, t
        props = {}
        for field, typ, tag in re.findall(r'^\s*(\w+)\s+(\S+)\s+`json:"([^"]+)"`', match[1], re.M):
            wire = tag.split(',')[0]
            if wire != '-': props[wire] = shape(typ)
        defs[t] = {'type':'object','properties':props,'additionalProperties':True}
    result = {'$schema':'https://json-schema.org/draft/2020-12/schema','title':prefix+' response shapes — source-derived, NOT official OpenAPI','$comment':'Partial projection of Go generated SDK JSON tags, primitive/pointer/array types and enums. No required fields inferred. Unexpanded types unconstrained. Pointer nullability and known enums describe source, not a verified complete wire contract. No live validation.','x-source':{'file':filename,'sha256':hashlib.sha256((ROOT/filename).read_bytes()).hexdigest(),'commit':'46763ab9fc78781eca1af94bd3a83750d3a2068f','generator':'dedicated-extract.py'},'$defs':defs}
    (ROOT/(prefix+'-response-shapes.schema.json')).write_text(json.dumps(result,indent=2)+'\n')
ops = []
for prefix, filename in [('projects','projects-js-packages_generated_account_src_v3_api.gen.ts'), ('dedicated','dedicated-js-packages_generated_inference_src_v1_api.gen.ts')]:
    source = (ROOT/filename).read_text()
    methods = ['pageOfListProjects','getProject'] if prefix == 'projects' else ['pageOfListDeployments','getDeployment','getDeploymentCertificate','pageOfListModels','getModel','pageOfListNodeTypes']
    for method in methods:
        start = source.index(method+' =')
        end = source.find('\n  /**',start)
        text = source[start:end if end != -1 else len(source)]
        path = re.search(r'path: `([^`]+)`',text)[1]
        queries = re.findall(r"\['([^']+)',",text)
        ops.append({'sdk_method':method,'http_method':'GET','path_expression':path,'query_wire_names':queries,'source_file':filename})
(ROOT/'dedicated-read-operations.source-derived.json').write_text(json.dumps({'kind':'Source-derived operation inventory, NOT OpenAPI, NOT executed requests','commit':'e05f031e8590090311adf028747139fe7b490d59','operations':ops,'standalone_list_endpoints':'Absent in inspected generated API'},indent=2)+'\n')
print('Wrote two partial response schema extracts and read-operation inventory')
