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


research_url = 'https://www.worldbank.org/en/research/all'
research_base = { channel: { url: research_url }, auto_source: {}, strategy: :auto }
research_input = LabulubiusHtml2rssProfiles.apply(research_base, research_url, LabulubiusHtml2rssProfiles::PROFILES)
research_config = Html2rss::Config.from_hash(research_input)
research_fixture = ENV.fetch('HTML2RSS_RESEARCH_FIXTURE', File.expand_path('../../tests/fixtures/worldbank-research-cards.html', __dir__))
research_response = Html2rss::RequestService::Response.new(body: File.read(research_fixture), url: Html2rss::Url.for_channel(research_url), headers: { 'content-type' => 'text/html' }, status: 200)
research_articles = Html2rss::Selectors.new(research_response, selectors: research_config.selectors, time_zone: research_config.time_zone).articles
check(research_articles.length == 20, 'exactly twenty research cards')
check(research_articles.all? { |article| article.url.to_s.start_with?('https://documents.worldbank.org/curated/') }, 'only World Bank document links')
check(research_articles.all?(&:published_at), 'all research dates extracted')
check(research_articles.first.published_at.strftime('%Y-%m-%d') == '2026-12-31', 'future source date retained for downstream policy')
check(research_articles[1].published_at.strftime('%Y-%m-%d') == '2026-10-09', 'displayed research date parsed')
check(research_articles.first.description.to_s.include?('România'), 'actual research description')
puts 'research selectors: PASS (20 cards, real dates and descriptions)'
