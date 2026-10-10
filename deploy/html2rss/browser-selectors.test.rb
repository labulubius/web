# frozen_string_literal: true

require_relative 'browser-profiles.test'
require 'html2rss'
require 'date'

url = 'https://www.worldbank.org/en/news/all?displayconttype_exact=Press+Release&lang_exact=English&qterm='
base = { channel: { url: url }, auto_source: {}, strategy: :auto }
input = LabulubiusHtml2rssProfiles.apply(base, url, LabulubiusHtml2rssProfiles::PROFILES)
config = Html2rss::Config.from_hash(input)
fixture = ENV.fetch('HTML2RSS_CARDS_FIXTURE', File.expand_path('../../tests/fixtures/worldbank-press-release-cards.html', __dir__))
response = Html2rss::RequestService::Response.new(body: File.read(fixture), url: Html2rss::Url.for_channel(url), headers: { 'content-type' => 'text/html' }, status: 200)
articles = Html2rss::Selectors.new(response, selectors: config.selectors, time_zone: config.time_zone).articles
check(articles.length == 10, 'exactly the rendered ten cards')
check(articles.all? { |article| article.url.to_s.include?('/news/press-release/') }, 'only press releases')
check(articles.first.title.include?('Guinea Economic Update'), 'actual headline')
check(articles.first.published_at.strftime('%Y-%m-%d') == '2026-10-09', 'display date, not the October 7 URL or today')
check(articles.all? { |article| article.published_at }, 'all dates extracted')
check(articles.first.description.to_s.include?("grew by 7.4%"), 'actual description')
check(articles.last.published_at.strftime('%Y-%m-%d') == '2026-10-06', 'last card date')
puts 'browser selectors: PASS (10 cards, real dates and descriptions)'
