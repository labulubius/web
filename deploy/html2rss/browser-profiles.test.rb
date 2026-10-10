# frozen_string_literal: true

ENV['HTML2RSS_BROWSER_PROFILES'] ||= File.expand_path('browser-profiles.yml', __dir__)
require_relative 'browser-profiles'

def check(condition, message)
  raise message unless condition
end

url = 'https://www.worldbank.org/en/news/all?displayconttype_exact=Press+Release&lang_exact=English&qterm='
base = { channel: { url: url }, auto_source: {}, strategy: :auto }
profiles = LabulubiusHtml2rssProfiles::PROFILES
result = LabulubiusHtml2rssProfiles.apply(base, url, profiles)
check(result.dig(:channel, :url) == url, 'URL/filter preservation')
check(result[:strategy] == 'botasaurus', 'browser strategy')
check(result.dig(:selectors, :published_at, :post_process).last[:name] == 'parse_time', 'date extraction')
check(!result.key?(:auto_source), 'no heuristic/navigation contamination')
check(base[:strategy] == :auto && base.key?(:auto_source), 'no mutation')
check(result.dig(:request, :botasaurus, :wait_timeout_seconds) == 20, 'bounded wait')
%w[https://example.org/en/news/all http://www.worldbank.org/en/news/all https://www.worldbank.org/en/news/all].each do |other|
  check(LabulubiusHtml2rssProfiles.apply(base, other, profiles).equal?(base), 'unmatched sources unchanged')
end
wrong_filter = url.sub('Press+Release', 'Statement')
check(LabulubiusHtml2rssProfiles.apply(base, wrong_filter, profiles).equal?(base), 'respect content filter')
check(LabulubiusHtml2rssProfiles.apply(base, url + '&lang_exact=English', profiles).equal?(base), 'reject duplicate query keys')
check(LabulubiusHtml2rssProfiles.apply(base, url.gsub('+', '%20'), profiles)[:strategy] == 'botasaurus', 'query encoding')

research_url = 'https://www.worldbank.org/en/research/all'
research_base = { channel: { url: research_url }, auto_source: {}, strategy: :auto }
research = LabulubiusHtml2rssProfiles.apply(research_base, research_url, profiles)
check(research.dig(:channel, :url) == research_url, 'research URL preservation')
check(research[:strategy] == 'default', 'research uses ordinary HTTP strategy')
check(research.dig(:selectors, :items, :selector) == '.n07v4 > ul > li', 'research card selector')
check(research.dig(:selectors, :published_at, :post_process).last[:name] == 'parse_time', 'research date extraction')
check(!research.key?(:auto_source), 'research disables heuristic extraction')
check(LabulubiusHtml2rssProfiles.apply(research_base, research_url + '?lang=English', profiles)[:strategy] == 'default', 'research query preservation')
check(LabulubiusHtml2rssProfiles.apply(research_base, research_url.sub('https:', 'http:'), profiles).equal?(research_base), 'research requires HTTPS')

# Exercise the actual prepend/bootstrap ordering used by RUBYOPT.
# Some libraries (e.g. REXML::Functions) override Module.name with an XPath
# function. The hook must use the native Module getter, not invoke that function.
module OverriddenModuleNameCanary
  def self.name
    raise 'Module.name override must not be invoked'
  end
end
check(!defined?(Html2rss::Web::Feeds::SourceResolver), 'do not predeclare upstream namespace')
module Html2rss
  module Web
    module Feeds
      module SourceResolver
        class << self
          def token_generator_input(url, strategy)
            { channel: { url: url }, auto_source: {}, strategy: strategy.to_sym }
          end
        end
      end
    end
  end
end
check(Html2rss::Web::Feeds::SourceResolver.send(:token_generator_input, url, 'auto')[:strategy] == 'botasaurus', 'resolver integration')
puts 'browser profiles: PASS'

# Test the actual pinned transport method, not a reimplementation of it.
require 'html2rss'
transport = Html2rss::RequestService::BotasaurusStrategy.allocate
policy = Struct.new(:connect_timeout_seconds, :read_timeout_seconds).new(5, 10)
context = Struct.new(:policy).new(policy)
transport.define_singleton_method(:ctx) { context }
timeouts = transport.send(:client_timeouts, 32.0)
check(timeouts[:read_timeout] == 32.0, 'browser read wait matches bounded attempt, not 10s HTTP default')
check(timeouts[:connect_timeout] == 5, 'ordinary connection cap unchanged')
check(timeouts[:total_request_timeout] == 32.0, 'total browser cap unchanged')
check(!LabulubiusHtml2rssProfiles::LOAD_HOOK.enabled?, 'one-time hook disabled after both targets load')
puts 'browser transport deadline: PASS'
