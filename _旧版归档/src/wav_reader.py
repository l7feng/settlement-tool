# -*- coding: utf-8 -*-
"""读取 wav 文件时长，返回 HH:MM:SS 字符串。

仅依赖标准库 wave，支持 PCM 编码的 wav（ProTools / 多数 DAW 导出均为此格式）。
非 wav 或损坏文件抛出 ValueError，由调用方提示。
"""
import wave
import contextlib


def wav_duration(path):
    """返回 wav 时长，格式 'HH:MM:SS'（整秒，与现有结算表口径一致）。"""
    try:
        with contextlib.closing(wave.open(path, 'rb')) as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            if rate <= 0:
                raise ValueError('无法读取采样率')
            total_sec = int(frames / rate)
    except wave.Error as e:
        raise ValueError('非 PCM wav 或文件损坏：%s' % e)
    except Exception as e:
        raise ValueError('读取失败：%s' % e)
    h, rem = divmod(total_sec, 3600)
    m, s = divmod(rem, 60)
    return '%02d:%02d:%02d' % (h, m, s)


def t2sec(t):
    """'HH:MM:SS' → 总秒数。"""
    h, m, s = (int(x) for x in str(t).split(':'))
    return h * 3600 + m * 60 + s
