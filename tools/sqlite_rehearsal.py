"""离线 SQLite 迁移演练；路径必须明确指定，绝不接管应用真实存储。"""
import argparse
import copy
from contextlib import closing
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import uuid

SCHEMA_VERSION = 1
NAMESPACE = uuid.UUID('94b0d37e-8fda-4997-a40f-9099d4938c62')


class MigrationError(ValueError):
    pass


def _dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def _load(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise MigrationError('JSON 重复字段：' + key)
            if key in ('__proto__', 'prototype', 'constructor'):
                raise MigrationError('JSON 含危险字段：' + key)
            result[key] = value
        return result
    try:
        return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=pairs,
                          parse_constant=lambda x: (_ for _ in ()).throw(MigrationError('非有限数值')))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise MigrationError('来源不是有效 UTF-8 JSON') from error


def _identity(existing, seed, seen):
    if existing is not None and (not isinstance(existing, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', existing)):
        raise MigrationError('稳定 ID 必须为 1 至 128 位字母、数字、下划线或短横线')
    value = existing or str(uuid.uuid5(NAMESPACE, seed))
    if value in seen:
        raise MigrationError('重复稳定 ID：' + value)
    seen.add(value)
    return value


def preview(source_path, source_id):
    """只读预演：保留原文，并列出任何超过两位的单价差异。"""
    if not isinstance(source_id, str) or not source_id.strip():
        raise MigrationError('必须明确提供来源标识')
    raw = Path(source_path).read_bytes()
    original = _load(raw)
    if not isinstance(original, dict):
        raise MigrationError('来源根节点必须为对象')
    enveloped = 'formatVersion' in original
    if enveloped and original['formatVersion'] != 2:
        raise MigrationError('不支持的备份版本')
    data = copy.deepcopy(original.get('data') if enveloped else original)
    if not isinstance(data, dict) or not isinstance(data.get('prices'), dict) or not isinstance(data.get('projects'), list):
        raise MigrationError('来源缺少单价或项目列表')
    if data.get('schemaVersion', 1) not in (1, 2, 3):
        raise MigrationError('不支持的数据版本')
    prices, differences = {}, []
    for grade in ('A', 'B', 'C', 'D'):
        row = data['prices'].get(grade)
        if not isinstance(row, dict):
            raise MigrationError('缺少等级单价：' + grade)
        prices[grade] = {}
        for key in ('per_min', 'per_ep'):
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise MigrationError('单价不是数值')
            value = Decimal(str(value))
            if not value.is_finite() or value < 0 or value > 100000000:
                raise MigrationError('单价超出范围')
            rounded = value.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
            if value != rounded:
                differences.append({'grade': grade, 'field': key, 'original': str(value),
                                    'proposed': str(rounded), 'delta': str(rounded - value)})
            prices[grade][key] = value
    seen, names, project_rows, record_rows = set(), set(), [], []
    total = Decimal(0)
    if len(data['projects']) > 10000:
        raise MigrationError('项目数量超过范围')
    for index, project in enumerate(data['projects']):
        if not isinstance(project, dict) or not isinstance(project.get('name'), str) or not project['name'].strip():
            raise MigrationError('项目名称无效')
        aliases = project.get('aliases', [])
        if not isinstance(aliases, list) or any(not isinstance(a, str) or not a.strip() for a in aliases):
            raise MigrationError('项目别名无效')
        short_name = project.get('shortName', '')
        if not isinstance(short_name, str) or (short_name and not re.fullmatch(r'[\u3400-\u9fff]{2,4}', short_name)):
            raise MigrationError('项目缩写必须为空或 2 至 4 个中文汉字')
        identities = set([project['name'], *aliases])
        if names & identities:
            raise MigrationError('项目名称或别名身份冲突')
        names.update(identities)
        if project.get('grade') not in prices or project.get('mode') not in ('按集', '按时长') or project.get('type') not in ('正式', 'Demo'):
            raise MigrationError('项目等级、类型或计价方式无效')
        episodes = project.get('episodes')
        if not isinstance(episodes, dict):
            raise MigrationError('集数记录必须为对象')
        project['id'] = _identity(project.get('id'), f'{source_id}/project/{index}/{project["name"]}', seen)
        project_rows.append((project['id'], index, _dump({k: v for k, v in project.items() if k != 'episodes'})))
        for key, record in episodes.items():
            if not key.strip() or not isinstance(record, dict):
                raise MigrationError('工作记录无效')
            record['recordId'] = _identity(record.get('recordId'), f'{source_id}/record/{project["id"]}/{key}', seen)
            try:
                if not isinstance(record.get('date'), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', record['date']):
                    raise ValueError()
                date.fromisoformat(record['date'])
                duration = record.get('duration', '')
                if not isinstance(duration, str) or not re.fullmatch(r'\d{2,4}:[0-5]\d:[0-5]\d', duration):
                    raise ValueError()
                hours, minutes, seconds = map(int, duration.split(':'))
            except (ValueError, TypeError) as error:
                raise MigrationError('日期或时长无效') from error
            grade = record.get('grade', project['grade'])
            mode = record.get('mode', project['mode'])
            work = record.get('workType', '重混' if record.get('rework') else '混音')
            if grade not in prices or mode not in ('按集', '按时长') or work not in ('首次制作', '混音', '重混', '修改'):
                raise MigrationError('记录计价属性无效')
            for boolean in ('excluded', 'billable', 'rework', 'needsReview', 'countInAssessment', 'multiVersion'):
                if boolean in record and not isinstance(record[boolean], bool):
                    raise MigrationError('记录布尔字段无效')
            amount_cents = 0
            if work != '修改' and not record.get('excluded') and record.get('billable') is not False:
                if mode == '按集':
                    amount_cents = int(prices[grade]['per_ep'].quantize(Decimal('.01'), rounding=ROUND_HALF_UP) * 100)
                else:
                    # 保持旧界面 IEEE-754 逐条 Math.round 口径，不能在迁移时换算法。
                    legacy_fee = (hours * 3600 + minutes * 60 + seconds) / 60 * float(prices[grade]['per_min'])
                    amount_cents = math.floor(legacy_fee * 100 + .5)
            total += Decimal(amount_cents) / 100
            record_rows.append((record['recordId'], project['id'], key, amount_cents, _dump(record)))
            if len(record_rows) > 100000:
                raise MigrationError('记录数量超过范围')
    export = copy.deepcopy(original)
    if enveloped:
        export['data'] = data
    else:
        export = data
    return {'ok': not differences, 'source_id': source_id, 'sha256': hashlib.sha256(raw).hexdigest(),
            'raw': raw, 'export': export, 'projects': project_rows, 'records': record_rows,
            'project_count': len(project_rows), 'record_count': len(record_rows),
            'amount_cents': int(total * 100), 'price_differences': differences}


def _connect_readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)


def _check(conn):
    if conn.execute('PRAGMA user_version').fetchone()[0] != SCHEMA_VERSION:
        raise MigrationError('目标数据库 schema 不匹配')
    if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise MigrationError('数据库完整性校验失败')
    if conn.execute('PRAGMA foreign_key_check').fetchall():
        raise MigrationError('数据库项目引用校验失败')
    row = conn.execute('SELECT sha256,raw,project_count,record_count,amount_cents FROM sources').fetchall()
    if len(row) != 1:
        raise MigrationError('演练数据库必须包含唯一来源')
    sha, raw, projects, records, cents = row[0]
    if hashlib.sha256(raw).hexdigest() != sha:
        raise MigrationError('来源原文校验失败')
    if conn.execute('SELECT COUNT(*) FROM projects').fetchone()[0] != projects or conn.execute('SELECT COUNT(*),COALESCE(SUM(amount_cents),0) FROM records').fetchone() != (records, cents):
        raise MigrationError('数量或金额校验失败')


def read_commit(source_path, database_path, source_id, *, _before_commit=None):
    """只创建新库；已有库仅接受同来源、同原文的幂等复核，不执行更新。"""
    result = preview(source_path, source_id)
    if not result['ok']:
        raise MigrationError('单价超过两位小数，请先人工裁决；禁止静默舍入')
    database = Path(database_path)
    if database.exists():
        try:
            with closing(_connect_readonly(database)) as conn:
                _check(conn)
                identity = conn.execute('SELECT source_id,sha256 FROM sources').fetchone()
                if identity != (source_id, result['sha256']):
                    raise MigrationError('目标已存在且来源身份或内容冲突；恢复必须选择新数据库')
        except sqlite3.DatabaseError as error:
            raise MigrationError('目标已存在且不是有效演练数据库') from error
        return {**summary(result), 'repeated': True}
    # 独占创建防止检查与创建之间被其他进程抢占；失败时保留空库供排查。
    fd = os.open(database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    conn = sqlite3.connect(database)
    try:
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('BEGIN IMMEDIATE')
        for sql in (
            'CREATE TABLE sources(source_id TEXT PRIMARY KEY,sha256 TEXT NOT NULL,raw BLOB NOT NULL,export_json TEXT NOT NULL,project_count INTEGER NOT NULL,record_count INTEGER NOT NULL,amount_cents INTEGER NOT NULL)',
            'CREATE TABLE projects(id TEXT PRIMARY KEY,position INTEGER UNIQUE NOT NULL,json TEXT NOT NULL)',
            'CREATE TABLE records(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),record_key TEXT NOT NULL,amount_cents INTEGER NOT NULL,json TEXT NOT NULL,UNIQUE(project_id,record_key))',
        ):
            conn.execute(sql)
        conn.execute('PRAGMA user_version=1')
        conn.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?)', (source_id, result['sha256'], result['raw'], _dump(result['export']), result['project_count'], result['record_count'], result['amount_cents']))
        conn.executemany('INSERT INTO projects VALUES(?,?,?)', result['projects'])
        conn.executemany('INSERT INTO records VALUES(?,?,?,?,?)', result['records'])
        _check(conn)
        if _before_commit:
            _before_commit(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {**summary(result), 'repeated': False}


def reexport(database_path, *, original=False):
    """默认按数据库实体重建原字段与 ID；original=True 返回原始字节。"""
    with closing(_connect_readonly(database_path)) as conn:
        _check(conn)
        raw, exported = conn.execute('SELECT raw,export_json FROM sources').fetchone()
        if original:
            return raw
        root = json.loads(exported)
        data = root['data'] if 'formatVersion' in root else root
        projects = []
        for identity, _, project_json in conn.execute('SELECT id,position,json FROM projects ORDER BY position'):
            project = json.loads(project_json)
            project['episodes'] = {key: json.loads(record_json) for key, record_json in conn.execute('SELECT record_key,json FROM records WHERE project_id=? ORDER BY rowid', (identity,))}
            projects.append(project)
        data['projects'] = projects
        if _dump(root) != _dump(json.loads(exported)):
            # 对象键顺序不同允许；实体内容必须与导入快照一致。
            if root != json.loads(exported):
                raise MigrationError('实体与来源快照不一致')
        return root


def summary(result):
    return {key: result[key] for key in ('ok', 'source_id', 'sha256', 'project_count', 'record_count', 'amount_cents', 'price_differences')}


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--preview', metavar='JSON')
    action.add_argument('--import', dest='source', metavar='JSON')
    parser.add_argument('--source-id', required=True)
    parser.add_argument('--database', metavar='NEW_SQLITE')
    args = parser.parse_args()
    try:
        if args.preview:
            output = summary(preview(args.preview, args.source_id))
        else:
            if not args.database:
                parser.error('--import 必须明确提供 --database')
            output = read_commit(args.source, args.database, args.source_id)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0 if output['ok'] else 2
    except (MigrationError, OSError, sqlite3.Error) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
