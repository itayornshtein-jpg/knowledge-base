from datetime import datetime, timezone
from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import os
import re
from uuid import uuid4

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_FILE = os.path.join(BASE_DIR, 'db.json')
DEFAULT_MODEL = 'gpt-5.4-mini'
VALID_VIEWS = {'active', 'archived', 'all'}
ENTRY_FIELDS = ['summary', 'sf_case', 'jira_link', 'description', 'solution']
REQUIRED_FIELDS = ['sf_case', 'description', 'solution', 'summary']


def get_db_file():
    return app.config.get('DB_FILE', DEFAULT_DB_FILE)


def ensure_db_file():
    db_file = get_db_file()
    if not os.path.exists(db_file):
      with open(db_file, 'w', encoding='utf-8') as handle:
          json.dump([], handle, indent=2)


def coerce_text(value):
    if value is None:
        return ''
    return str(value).strip()


def normalize_related_ids(value):
    if not isinstance(value, list):
        return []

    seen = set()
    normalized = []

    for item in value:
        item_text = coerce_text(item)
        if item_text and item_text not in seen:
            seen.add(item_text)
            normalized.append(item_text)

    return normalized


def normalize_entry(entry=None):
    entry = entry or {}

    return {
        'id': coerce_text(entry.get('id')) or f'page_{uuid4().hex[:12]}',
        'summary': coerce_text(entry.get('summary')),
        'sf_case': coerce_text(entry.get('sf_case')),
        'jira_link': coerce_text(entry.get('jira_link')),
        'description': coerce_text(entry.get('description')),
        'solution': coerce_text(entry.get('solution')),
        'related_page_ids': normalize_related_ids(entry.get('related_page_ids')),
        'deleted_at': coerce_text(entry.get('deleted_at')) or None,
    }


def read_db():
    ensure_db_file()

    with open(get_db_file(), 'r', encoding='utf-8') as handle:
        raw_data = json.load(handle)

    if not isinstance(raw_data, list):
        raw_data = []

    normalized_data = [normalize_entry(item) for item in raw_data if isinstance(item, dict)]

    if normalized_data != raw_data:
        write_db(normalized_data)

    return normalized_data


def write_db(data):
    with open(get_db_file(), 'w', encoding='utf-8') as handle:
        json.dump(data, handle, indent=2)


def filter_entries(entries, view):
    if view == 'archived':
        return [entry for entry in entries if entry['deleted_at']]

    if view == 'all':
        return entries

    return [entry for entry in entries if not entry['deleted_at']]


def find_entry_index(entries, entry_id):
    for index, entry in enumerate(entries):
        if entry['id'] == entry_id:
            return index

    return -1


def validate_view(view):
    if view not in VALID_VIEWS:
        return 'active'

    return view


def validate_entry_payload(payload, entries, current_entry_id=None):
    if not isinstance(payload, dict):
        return None, 'Payload must be a JSON object.'

    normalized = {field: coerce_text(payload.get(field)) for field in ENTRY_FIELDS}
    normalized['related_page_ids'] = normalize_related_ids(payload.get('related_page_ids'))

    for field in REQUIRED_FIELDS:
        if not normalized[field]:
            return None, f'Missing mandatory field: {field}'

    if 'related_page_ids' in payload and not isinstance(payload.get('related_page_ids'), list):
        return None, 'related_page_ids must be an array of page IDs.'

    active_ids = {entry['id'] for entry in entries if not entry['deleted_at']}
    invalid_ids = [item for item in normalized['related_page_ids'] if item not in active_ids]

    if invalid_ids:
        return None, 'All related pages must exist and remain active.'

    if current_entry_id and current_entry_id in normalized['related_page_ids']:
        return None, 'A page cannot reference itself.'

    return normalized, None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def normalize_search_text(text):
    return re.sub(r'\s+', ' ', coerce_text(text).lower()).strip()


def tokenize(text):
    return re.findall(r'[a-z0-9]+', normalize_search_text(text))


def count_overlap(query_tokens, source_text):
    source_tokens = set(tokenize(source_text))
    return sum(1 for token in query_tokens if token in source_tokens)


def normalize_case_token(text):
    return re.sub(r'[^a-z0-9]', '', normalize_search_text(text))


def build_related_summary_text(entry, active_entry_map):
    return ' '.join(
        active_entry_map[related_id]['summary']
        for related_id in entry['related_page_ids']
        if related_id in active_entry_map
    )


def score_entry(entry, query_text, query_tokens, active_entry_map):
    summary_text = normalize_search_text(entry['summary'])
    description_text = normalize_search_text(entry['description'])
    solution_text = normalize_search_text(entry['solution'])
    jira_text = normalize_search_text(entry['jira_link'])
    related_summary_text = normalize_search_text(build_related_summary_text(entry, active_entry_map))
    case_token = normalize_case_token(entry['sf_case'])
    query_case_token = normalize_case_token(query_text)

    score = 0

    if query_text and query_text in summary_text:
        score += 30

    score += count_overlap(query_tokens, summary_text) * 8
    score += count_overlap(query_tokens, description_text) * 4
    score += count_overlap(query_tokens, solution_text) * 4
    score += count_overlap(query_tokens, related_summary_text) * 2
    score += count_overlap(query_tokens, jira_text)

    if query_text and query_text in description_text:
        score += 10

    if query_text and query_text in solution_text:
        score += 10

    if query_case_token and case_token and query_case_token == case_token:
        score += 90
    elif query_case_token and case_token and case_token in query_case_token:
        score += 45

    return score


def rank_entries(messages, view='active'):
    active_entries = filter_entries(read_db(), view)
    active_entry_map = {entry['id']: entry for entry in active_entries}
    user_text = ' '.join(
        coerce_text(message.get('content'))
        for message in messages
        if isinstance(message, dict) and message.get('role') == 'user'
    ).strip()
    query_text = normalize_search_text(user_text)
    query_tokens = tokenize(user_text)

    if not query_text:
        return []

    scored_entries = []

    for entry in active_entries:
        score = score_entry(entry, query_text, query_tokens, active_entry_map)
        if score > 0:
            scored_entries.append((score, entry))

    scored_entries.sort(key=lambda item: (-item[0], item[1]['summary'].lower()))
    return [entry for _, entry in scored_entries[:5]]


def build_page_context(entry, active_entry_map):
    related_pages = [
        {
            'id': related_id,
            'summary': active_entry_map[related_id]['summary'],
            'sf_case': active_entry_map[related_id]['sf_case'],
        }
        for related_id in entry['related_page_ids']
        if related_id in active_entry_map
    ]

    return {
        'id': entry['id'],
        'summary': entry['summary'],
        'sf_case': entry['sf_case'],
        'jira_link': entry['jira_link'],
        'description': entry['description'],
        'solution': entry['solution'],
        'related_pages': related_pages,
    }


def get_openai_client():
    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        return None, 'OPENAI_API_KEY is not configured on the backend.'

    if OpenAI is None:
        return None, 'The Python openai package is not installed.'

    return OpenAI(api_key=api_key), None


def generate_ai_answer(messages, matched_entries):
    client, error_message = get_openai_client()
    if error_message:
        raise RuntimeError(error_message)

    active_entry_map = {entry['id']: entry for entry in matched_entries}
    knowledge_pages = [build_page_context(entry, active_entry_map) for entry in matched_entries]
    model = os.getenv('OPENAI_MODEL', DEFAULT_MODEL)

    system_prompt = (
        'You are a support knowledge assistant. Answer using only the supplied knowledge pages. '
        'Do not invent facts, steps, causes, or links that are not present in the supplied pages. '
        'If the supplied pages are insufficient, return refusal=true and explain that the knowledge base '
        'does not contain enough evidence. End the answer with a short Sources line that references only '
        'the cited page summaries.'
    )

    user_prompt = json.dumps(
        {
            'conversation': messages[-8:],
            'knowledge_pages': knowledge_pages,
            'instruction': 'Return JSON with answer, citation_ids, and refusal.',
        },
        ensure_ascii=True,
    )

    response = client.responses.create(
        model=model,
        input=[
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt},
        ],
        text={
            'format': {
                'type': 'json_schema',
                'name': 'knowledge_assistant_response',
                'strict': True,
                'schema': {
                    'type': 'object',
                    'additionalProperties': False,
                    'properties': {
                        'answer': {'type': 'string'},
                        'citation_ids': {
                            'type': 'array',
                            'items': {'type': 'string'},
                        },
                        'refusal': {'type': 'boolean'},
                    },
                    'required': ['answer', 'citation_ids', 'refusal'],
                },
            },
        },
    )

    payload = json.loads(response.output_text)
    citations = []
    seen = set()

    for citation_id in payload.get('citation_ids', []):
        if citation_id in active_entry_map and citation_id not in seen:
            seen.add(citation_id)
            entry = active_entry_map[citation_id]
            citations.append(
                {
                    'id': entry['id'],
                    'summary': entry['summary'],
                    'sf_case': entry['sf_case'],
                }
            )

    if not payload.get('refusal') and not citations and matched_entries:
        first_entry = matched_entries[0]
        citations.append(
            {
                'id': first_entry['id'],
                'summary': first_entry['summary'],
                'sf_case': first_entry['sf_case'],
            }
        )

    return {
        'answer': coerce_text(payload.get('answer')),
        'citations': citations,
        'matched_pages': [
            {
                'id': entry['id'],
                'summary': entry['summary'],
                'sf_case': entry['sf_case'],
            }
            for entry in matched_entries
        ],
        'refusal': bool(payload.get('refusal')),
    }


@app.route('/api/knowledge', methods=['GET'])
def get_entries():
    view = validate_view(request.args.get('view', 'active'))
    entries = filter_entries(read_db(), view)
    return jsonify(entries)


@app.route('/api/knowledge', methods=['POST'])
def add_entry():
    entries = read_db()
    payload, error_message = validate_entry_payload(request.get_json(silent=True), entries)

    if error_message:
        return jsonify({'error': error_message}), 400

    new_entry = normalize_entry(payload)
    entries.append(new_entry)
    write_db(entries)
    return jsonify(new_entry), 201


@app.route('/api/knowledge/<entry_id>', methods=['PUT'])
def update_entry(entry_id):
    entries = read_db()
    entry_index = find_entry_index(entries, entry_id)

    if entry_index == -1:
        return jsonify({'error': 'Knowledge page not found.'}), 404

    payload, error_message = validate_entry_payload(
        request.get_json(silent=True),
        entries,
        current_entry_id=entry_id,
    )

    if error_message:
        return jsonify({'error': error_message}), 400

    current_entry = entries[entry_index]
    updated_entry = normalize_entry(
        {
            **current_entry,
            **payload,
            'id': current_entry['id'],
            'deleted_at': current_entry['deleted_at'],
        }
    )

    entries[entry_index] = updated_entry
    write_db(entries)
    return jsonify(updated_entry)


@app.route('/api/knowledge/<entry_id>/archive', methods=['POST'])
def archive_entry(entry_id):
    entries = read_db()
    entry_index = find_entry_index(entries, entry_id)

    if entry_index == -1:
        return jsonify({'error': 'Knowledge page not found.'}), 404

    entries[entry_index]['deleted_at'] = now_iso()
    write_db(entries)
    return jsonify(entries[entry_index])


@app.route('/api/knowledge/<entry_id>/restore', methods=['POST'])
def restore_entry(entry_id):
    entries = read_db()
    entry_index = find_entry_index(entries, entry_id)

    if entry_index == -1:
        return jsonify({'error': 'Knowledge page not found.'}), 404

    entries[entry_index]['deleted_at'] = None
    write_db(entries)
    return jsonify(entries[entry_index])


@app.route('/api/assistant/chat', methods=['POST'])
def assistant_chat():
    payload = request.get_json(silent=True) or {}
    messages = payload.get('messages', [])
    view = validate_view(payload.get('view', 'active'))

    if not isinstance(messages, list) or not messages:
        return jsonify({'error': 'messages must be a non-empty array.'}), 400

    matched_entries = rank_entries(messages, view='active' if view == 'all' else view)
    if not matched_entries:
        return jsonify(
            {
                'answer': 'I could not find a supporting knowledge page for that question.',
                'citations': [],
                'matched_pages': [],
                'refusal': True,
            }
        )

    try:
        return jsonify(generate_ai_answer(messages, matched_entries))
    except RuntimeError as error:
        return jsonify({'error': str(error)}), 503
    except Exception as error:
        return jsonify({'error': f'Assistant request failed: {error}'}), 502


if __name__ == '__main__':
    ensure_db_file()
    app.run(debug=True, port=5001)
