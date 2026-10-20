"""Offline schema/sequence conformance. Not authority, server or production validator."""
import json
from pathlib import Path
from jsonschema import Draft7Validator
ROOT=Path(__file__).resolve().parents[2]
def sequence_ok(events):
    if not events or events[0]['type']!='run.started':return False
    binding=events[0]['binding'];terminal=False;last=0
    for index,event in enumerate(events):
        if terminal or event['binding']!=binding or event['sequence']!=last+1:return False
        if index and event['type']=='run.started':return False
        last=event['sequence']
        if event['type']=='run.terminal':
            terminal=True;d=event['data']
            if d['state']=='succeeded' and (d['output_status']!='complete' or d['remote_outcome']!='completed' or d['usage_status']!='known' or d['reconciliation_required']):return False
            if (d['remote_outcome']=='unknown' or d['usage_status']=='unknown') and not d['reconciliation_required']:return False
    return terminal

def main():
    validators={}
    for name in ['agent-spec','runtime-http','runtime-events','webview-ipc']:
        schema=json.loads((ROOT/'contracts'/name/'v1/schema.json').read_text())
        Draft7Validator.check_schema(schema);validators[name]=Draft7Validator(schema)
    results=[]
    for case in json.loads((ROOT/'contracts/fixtures/schema-cases.json').read_text()):
        actual=validators[case['contract']].is_valid(case['value'])
        assert actual==case['valid'],case['name']
        results.append({'name':case['name'],'valid':actual})
    for case in json.loads((ROOT/'contracts/fixtures/run-sequences.json').read_text()):
        actual=all(validators['runtime-events'].is_valid(e) for e in case['events']) and sequence_ok(case['events'])
        assert actual==case['valid'],case['name'];results.append({'name':case['name'],'valid':actual})
    print(json.dumps(results))
if __name__=='__main__':main()
