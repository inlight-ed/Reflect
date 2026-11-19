import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The test runner compiles JSX with the classic transform (Vite does the app build), which expects a global React.
(globalThis as { React?: typeof React }).React = React;
const { Badge, Button, Card, IconButton, InlineNotice, Select, SkeletonMetric, SkeletonText, TextField, fieldIds } = await import('../components/ui');
const h = React.createElement;

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const attr = (markup: string, tag: string, name: string) => markup.match(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`))?.[1];

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    const markup = html(h(Button, null, 'Сохранить'));
    assert.equal(attr(markup, 'button', 'type'), 'button');
    assert.match(markup, /rf-button--primary/);
  });

  it('while pending is disabled, busy and keeps its text', () => {
    const markup = html(h(Button, { pending: true, variant: 'secondary' }, 'Загрузить'));
    assert.match(markup, /<button[^>]*disabled=""/);
    assert.equal(attr(markup, 'button', 'aria-busy'), 'true');
    assert.match(markup, />Загрузить</);
  });
});

describe('IconButton', () => {
  it('has an accessible name and a tooltip from its label; the icon is hidden', () => {
    const markup = html(h(IconButton, { label: 'Обновить данные', icon: h('svg') }));
    assert.equal(attr(markup, 'button', 'aria-label'), 'Обновить данные');
    assert.equal(attr(markup, 'button', 'title'), 'Обновить данные');
    assert.match(markup, /<span aria-hidden="true" class="rf-button__icon"><svg>/);
  });
});

describe('TextField and Select', () => {
  it('ties label, description and error to the control', () => {
    const markup = html(h(TextField, { id: 'email', label: 'Почта', description: 'Рабочая почта', error: 'Неверный адрес', type: 'email' }));
    assert.equal(attr(markup, 'label', 'for'), 'email');
    assert.equal(attr(markup, 'input', 'id'), 'email');
    assert.equal(attr(markup, 'input', 'aria-describedby'), 'email-description email-error');
    assert.equal(attr(markup, 'input', 'aria-invalid'), 'true');
    assert.equal(attr(markup, 'p', 'id'), 'email-description');
    assert.match(markup, /id="email-error"[^>]*>.*Неверный адрес/);
  });

  it('is valid and points nowhere when there is no description or error', () => {
    const markup = html(h(TextField, { id: 'name', label: 'Имя' }));
    assert.equal(attr(markup, 'input', 'aria-describedby'), undefined);
    assert.equal(attr(markup, 'input', 'aria-invalid'), undefined);
  });

  it('generates an id when none is given, so the label still points at the control', () => {
    const markup = html(h(TextField, { label: 'Имя' }));
    const id = attr(markup, 'input', 'id');
    assert.ok(id);
    assert.equal(attr(markup, 'label', 'for'), id);
  });

  it('keeps a caller describedby first', () => {
    assert.equal(fieldIds('x', true, false, 'hint').describedBy, 'hint x-description');
  });

  it('Select renders a labelled native select with an optional empty first option', () => {
    const markup = html(h(Select, { id: 'period', label: 'Период', placeholder: 'Не выбран', options: [{ value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }] }));
    assert.equal(attr(markup, 'label', 'for'), 'period');
    assert.match(markup, /<select[^>]*id="period"/);
    assert.match(markup, /<option value="">Не выбран<\/option><option value="7">7 дней<\/option>/);
  });
});

describe('Badge', () => {
  it('always says its status in text; the dot is decorative', () => {
    const markup = html(h(Badge, { tone: 'danger' }, 'Убыток'));
    assert.match(markup, /rf-badge--danger/);
    assert.match(markup, /<span aria-hidden="true" class="rf-badge__dot"><\/span><span>Убыток<\/span>/);
  });

  it('adds a longer description for screen readers', () => {
    const markup = html(h(Badge, { tone: 'info', description: 'Источник: демо-снимок' }, 'Демо'));
    assert.match(markup, /class="visually-hidden"> — Источник: демо-снимок</);
    assert.equal(attr(markup, 'span', 'title'), 'Источник: демо-снимок');
  });
});

describe('InlineNotice', () => {
  it('interrupts for danger and stays polite otherwise', () => {
    assert.equal(attr(html(h(InlineNotice, { tone: 'danger' }, 'Ошибка')), 'div', 'role'), 'alert');
    assert.equal(attr(html(h(InlineNotice, { tone: 'info' }, 'Пояснение')), 'div', 'role'), 'status');
    assert.equal(attr(html(h(InlineNotice, { tone: 'warning', announce: 'none' }, 'Всегда на месте')), 'div', 'role'), undefined);
  });

  it('shows the title, the text and the action', () => {
    const markup = html(h(InlineNotice, { tone: 'warning', title: 'Данные устарели', action: h(Button, { size: 'sm' }, 'Обновить') }, 'Последняя синхронизация вчера'));
    assert.match(markup, /Данные устарели.*Последняя синхронизация вчера.*Обновить/);
  });
});

describe('Card and skeletons', () => {
  it('Card padding is chosen explicitly: padded content or a table edge to edge', () => {
    assert.match(html(h(Card, { padding: 'default' }, 'x')), /class="rf-card rf-card--pad"/);
    assert.match(html(h(Card, { padding: 'none', as: 'section' }, 'x')), /<section class="rf-card">/);
  });

  it('skeletons are hidden from assistive tech', () => {
    assert.match(html(h(SkeletonText, { lines: 2 })), /^<span class="rf-skeleton-text" aria-hidden="true">(<span class="rf-skeleton rf-skeleton--line"><\/span>){2}<\/span>$/);
    assert.match(html(h(SkeletonMetric)), /aria-hidden="true"/);
  });
});
