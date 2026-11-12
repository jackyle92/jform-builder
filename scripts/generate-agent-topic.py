#!/usr/bin/env python3
"""Generate the packaged JForm topic and its nine actions from the Agent Script assistant.

The Agent Script file (jform-agent-script/.../JForm_Assistant.agent) is the single source for
action labels, descriptions, inputs and outputs. This writes, under jform-agent/main/default:
  genAiFunctions/<Name>/<Name>.genAiFunction-meta.xml, input/schema.json, output/schema.json
Run it again after changing an action in the Agent Script file. The topic itself
(genAiPlugins/JForm_Form_Builder) is written by hand.

usage: python3 scripts/generate-agent-topic.py
"""
import json
import os
import re
import sys
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AGENT = os.path.join(ROOT, "jform-agent-script/main/default/aiAuthoringBundles/JForm_Assistant/JForm_Assistant.agent")
OUT = os.path.join(ROOT, "jform-agent/main/default/genAiFunctions")

TYPES = {"string": "lightning__textType", "integer": "lightning__integerType", "boolean": "lightning__booleanType", "number": "lightning__numberType"}


def unquote(v):
    v = v.strip()
    if v.startswith('"') and v.endswith('"'):
        return json.loads(v)
    return v


def parse_actions(lines):
    """The action definitions of the start_agent block: 8-space names, 12-space properties,
    16-space parameters, 20-space parameter properties."""
    start = next(i for i, l in enumerate(lines) if l.startswith("start_agent "))
    i = next(j for j in range(start, len(lines)) if lines[j] == "    actions:") + 1
    actions, action, section, param = {}, None, None, None
    for line in lines[i:]:
        if line.strip() == "":
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent <= 4:
            break
        text = line.strip()
        if indent == 8:
            action = actions.setdefault(text.rstrip(":"), {"inputs": {}, "outputs": {}})
            section = param = None
        elif indent == 12:
            key, _, value = text.partition(":")
            if key in ("inputs", "outputs"):
                section = key
            else:
                action[key] = unquote(value)
                section = None
        elif indent == 16 and section:
            name, _, typ = text.partition(":")
            param = action[section].setdefault(name, {"type": typ.strip()})
        elif indent == 20 and param is not None:
            key, _, value = text.partition(":")
            param[key] = unquote(value)
    return actions


def developer_name(key):
    return "JForm_" + "_".join(w.capitalize() for w in key.split("_"))


def truthy(v):
    return str(v).strip().lower() == "true"


def input_schema(params):
    props = {}
    for name, p in params.items():
        props[name] = {
            "title": p.get("label", name),
            "description": p.get("description", ""),
            "lightning:type": TYPES[p["type"]],
            "lightning:isPII": False,
            "copilotAction:isUserInput": False,
        }
    schema = {"required": [n for n, p in params.items() if truthy(p.get("is_required"))]}
    schema.update({"unevaluatedProperties": False, "properties": props, "lightning:type": "lightning__objectType"})
    return schema


def output_schema(params):
    props = {}
    for name, p in params.items():
        props[name] = {
            "title": p.get("label", name),
            "description": p.get("description", ""),
            "lightning:type": TYPES[p["type"]],
            "lightning:isPII": False,
            "copilotAction:isDisplayable": truthy(p.get("is_displayable")),
            "copilotAction:isUsedByPlanner": not truthy(p.get("filter_from_agent")),
            "copilotAction:useHydratedPrompt": False,
        }
    return {"unevaluatedProperties": False, "properties": props, "lightning:type": "lightning__objectType"}


def function_xml(a):
    target = a["target"]
    m = re.match(r"apex://(\w+)$", target)
    if not m:
        sys.exit(f"unsupported target {target}")
    rows = [
        f"    <description>{escape(a['description'])}</description>",
        f"    <invocationTarget>{m.group(1)}</invocationTarget>",
        "    <invocationTargetType>apex</invocationTargetType>",
        f"    <isConfirmationRequired>{'true' if truthy(a.get('require_user_confirmation')) else 'false'}</isConfirmationRequired>",
        f"    <isIncludeInProgressIndicator>{'true' if truthy(a.get('include_in_progress_indicator')) else 'false'}</isIncludeInProgressIndicator>",
        f"    <masterLabel>{escape(a['label'])}</masterLabel>",
    ]
    if a.get("progress_indicator_message"):
        rows.append(f"    <progressIndicatorMessage>{escape(a['progress_indicator_message'])}</progressIndicatorMessage>")
    return '<?xml version="1.0" encoding="UTF-8"?>\n<GenAiFunction xmlns="http://soap.sforce.com/2006/04/metadata">\n' + "\n".join(rows) + "\n</GenAiFunction>\n"


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    with open(AGENT, encoding="utf-8") as f:
        actions = parse_actions(f.read().splitlines())
    for key, a in actions.items():
        name = developer_name(key)
        base = os.path.join(OUT, name)
        write(os.path.join(base, f"{name}.genAiFunction-meta.xml"), function_xml(a))
        write(os.path.join(base, "input", "schema.json"), json.dumps(input_schema(a["inputs"]), indent=2) + "\n")
        write(os.path.join(base, "output", "schema.json"), json.dumps(output_schema(a["outputs"]), indent=2) + "\n")
        print(f"{name:32} {a['target'][7:]:28} in {len(a['inputs'])} out {len(a['outputs'])}")


if __name__ == "__main__":
    main()
