-- Run only against an isolated test database after applying migration 017.
begin;

do $$
declare
  term jsonb := '{"type":"term","value":"x"}';
  both_terms jsonb := '{"type":"and","left":{"type":"term","value":"x"},"right":{"type":"term","value":"y"}}';
  either jsonb := '{"type":"or","left":{"type":"term","value":"x"},"right":{"type":"term","value":"y"}}';
  matched boolean;
  score numeric;
begin
  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, '', repeat('x', 100) || repeat('a', 400), false);
  if matched is distinct from true or score is distinct from 200::numeric then
    raise exception 'Expected 100 hits in 500 characters to score 200, got %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, '', repeat('x', 101) || repeat('a', 899), false);
  if matched is distinct from true or score is distinct from 101::numeric then
    raise exception 'Expected 101 hits in 1000 characters to score 101, got %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, 'x', 'x' || repeat('中', 77) || '!', false);
  if matched is distinct from true or score is distinct from 5::numeric then
    raise exception 'A 79-character body should contribute zero, got %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, '', 'x', false);
  if matched is distinct from true or score is distinct from 0::numeric then
    raise exception 'A short matching body should still match with score zero: %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, 'x', 'x' || repeat('中', 77) || '! ', false);
  if matched is distinct from true or score is distinct from 17.5::numeric then
    raise exception 'An 80-character body should contribute 12.5, got %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, 'xxxxxx', null, false);
  if matched is distinct from true or score is distinct from 25::numeric then
    raise exception 'Empty body or capped headline bonus incorrect: %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, 'X', 'x', true);
  if matched is distinct from true or score is distinct from 5::numeric then
    raise exception 'Headline-only score changed: %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(term, '', 'x', true);
  if matched is distinct from false or score is distinct from 0::numeric then
    raise exception 'Headline-only search matched the body: %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(both_terms, '', 'xy' || repeat('a', 98), false);
  if matched is distinct from true or score is distinct from 20::numeric then
    raise exception 'AND score incorrect: %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(both_terms, '', 'x' || repeat('a', 99), false);
  if matched is distinct from false or score is distinct from 0::numeric then
    raise exception 'Unmatched AND should score zero: %, %', matched, score;
  end if;

  select matches, relevance_score into matched, score
  from public.chnscraping_evaluate_article_search(either, '', 'x' || repeat('a', 99), false);
  if matched is distinct from true or score is distinct from 10::numeric then
    raise exception 'OR score incorrect: %, %', matched, score;
  end if;
end;
$$;

insert into public.chnscraping_articles (id, source, headline, story_text, url, published_at)
values
  ('00000000-0000-0000-0000-000000000001', '__relevance_test__', '', repeat('x', 100) || repeat('a', 400), 'https://example.invalid/relevance/1', '2020-01-01'),
  ('00000000-0000-0000-0000-000000000002', '__relevance_test__', '', repeat('x', 101) || repeat('a', 899), 'https://example.invalid/relevance/2', '2020-01-02'),
  ('00000000-0000-0000-0000-000000000003', '__relevance_test__', '', 'x' || repeat('a', 99), 'https://example.invalid/relevance/3', '2020-01-03'),
  ('00000000-0000-0000-0000-000000000004', '__relevance_test__', '', 'x' || repeat('a', 99), 'https://example.invalid/relevance/4', '2020-01-04'),
  ('00000000-0000-0000-0000-000000000005', '__relevance_test__', '', 'x' || repeat('a', 99), 'https://example.invalid/relevance/5', '2020-01-04'),
  ('00000000-0000-0000-0000-000000000006', '__relevance_test__', '', 'x' || repeat('a', 998), 'https://example.invalid/relevance/6', '2020-01-01'),
  ('00000000-0000-0000-0000-000000000007', '__relevance_test__', '', 'x' || repeat('a', 999), 'https://example.invalid/relevance/7', '2020-01-07');

do $$
declare
  term jsonb := '{"type":"term","value":"x"}';
  result_ids uuid[];
  result_count bigint;
begin
  select array_agg(id), min(total_count) into result_ids, result_count
  from public.chnscraping_list_articles(term, false, '__relevance_test__', null, null, 1, 7);
  if result_ids is distinct from array[
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000004'::uuid,
    '00000000-0000-0000-0000-000000000005'::uuid,
    '00000000-0000-0000-0000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000006'::uuid,
    '00000000-0000-0000-0000-000000000007'::uuid
  ] or result_count is distinct from 7::bigint then
    raise exception 'Incorrect ordering or total count: %, %', result_ids, result_count;
  end if;

  select array_agg(id), min(total_count) into result_ids, result_count
  from public.chnscraping_list_articles(term, false, '__relevance_test__', null, null, 2, 2);
  if result_ids is distinct from array[
    '00000000-0000-0000-0000-000000000004'::uuid,
    '00000000-0000-0000-0000-000000000005'::uuid
  ] or result_count is distinct from 7::bigint then
    raise exception 'Incorrect page or total count: %, %', result_ids, result_count;
  end if;

  if has_function_privilege('anon', 'public.chnscraping_list_articles(jsonb,boolean,text,timestamptz,timestamptz,integer,integer)', 'execute')
    or not has_function_privilege('authenticated', 'public.chnscraping_list_articles(jsonb,boolean,text,timestamptz,timestamptz,integer,integer)', 'execute')
    or not has_function_privilege('service_role', 'public.chnscraping_list_articles(jsonb,boolean,text,timestamptz,timestamptz,integer,integer)', 'execute')
    or has_function_privilege('anon', 'public.chnscraping_evaluate_article_search(jsonb,text,text,boolean)', 'execute')
    or not has_function_privilege('authenticated', 'public.chnscraping_evaluate_article_search(jsonb,text,text,boolean)', 'execute')
    or not has_function_privilege('service_role', 'public.chnscraping_evaluate_article_search(jsonb,text,text,boolean)', 'execute') then
    raise exception 'Archive search RPC permissions changed';
  end if;
end;
$$;

rollback;
