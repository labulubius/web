# frozen_string_literal: true

# Optional, operator-owned request/selector profiles for the pinned html2rss web
# image. The URL-only create API otherwise drops per-source browser controls.
# This adapter changes neither authentication nor signed token formats.
require 'yaml'
require 'uri'

module LabulubiusHtml2rssProfiles
  module_function

  def load_profiles(path)
    data = YAML.safe_load_file(path, symbolize_names: true, aliases: false)
    raise ArgumentError, 'Expected a profiles array' unless data.is_a?(Hash) && data[:profiles].is_a?(Array)

    data[:profiles].each do |profile|
      match = profile.fetch(:match)
      config = profile.fetch(:config)
      unless match[:hostnames].is_a?(Array) && !match[:hostnames].empty? && match[:path].is_a?(String) &&
             match.fetch(:query, {}).is_a?(Hash) && config.is_a?(Hash)
        raise ArgumentError, 'Invalid browser profile'
      end
      unknown = config.keys - %i[strategy request selectors channel auto_source]
      raise ArgumentError, 'Unsupported profile keys' unless unknown.empty?
      if config.fetch(:channel, {}).key?(:url)
        raise ArgumentError, 'Profiles must preserve the submitted URL'
      end
      if config.fetch(:request, {}).key?(:local_file_path)
        raise ArgumentError, 'Local file requests are not allowed'
      end
      browser = config.dig(:request, :botasaurus) || {}
      if (browser.keys & %i[proxy headers cookies user_agent]).any?
        raise ArgumentError, 'Profiles must not carry credentials or proxies'
      end
    end
    data[:profiles]
  end

  def matches?(rule, url)
    uri = URI.parse(url)
    return false unless uri.scheme == 'https' && !uri.userinfo && !uri.fragment && [nil, 443].include?(uri.port)
    return false unless rule[:hostnames].include?(uri.hostname&.downcase) && rule[:path] == uri.path

    pairs = URI.decode_www_form(uri.query.to_s)
    return false unless pairs.map(&:first).uniq.length == pairs.length

    query = pairs.to_h
    rule.fetch(:query, {}).all? { |key, value| query[key.to_s] == value.to_s }
  rescue URI::InvalidURIError, ArgumentError
    false
  end

  def deep_merge(base, extra)
    base.merge(extra) do |_key, left, right|
      left.is_a?(Hash) && right.is_a?(Hash) ? deep_merge(left, right) : right
    end
  end

  def apply(base, url, profiles)
    profile = profiles.find { |candidate| matches?(candidate.fetch(:match), url) }
    return base unless profile

    extra = profile.fetch(:config)
    result = deep_merge(base, extra)
    # Explicit card selectors must not be polluted by automatic navigation links.
    result.delete(:auto_source) if extra.key?(:selectors) && !extra.key?(:auto_source)
    result
  end

  PROFILES = load_profiles(ENV.fetch('HTML2RSS_BROWSER_PROFILES', '/app/config/browser-profiles.yml'))

  module SourceResolverControls
    private

    def token_generator_input(url, strategy)
      LabulubiusHtml2rssProfiles.apply(super, url, LabulubiusHtml2rssProfiles::PROFILES)
    end
  end
end

# The pinned gem limits read_timeout to the normal HTTP policy default (10s),
# even when /scrape has a 30s wall. A browser response arrives only when rendering
# finishes: use its already-bounded attempt timeout, without changing connect or
# ordinary HTTP timeouts.
module LabulubiusHtml2rssProfiles
  module BrowserReadDeadline
    private

    def client_timeouts(timeout)
      super.merge(read_timeout: timeout)
    end
  end

  INSTALLED = []

  def self.install(loaded)
    return unless loaded.is_a?(Module)

    name = Module.instance_method(:name).bind_call(loaded)
    return if INSTALLED.include?(name)

    case name
    when 'Html2rss::Web::Feeds::SourceResolver'
      loaded.singleton_class.prepend(SourceResolverControls)
    when 'Html2rss::RequestService::BotasaurusStrategy'
      loaded.prepend(BrowserReadDeadline)
    else
      return
    end
    INSTALLED << name
    LOAD_HOOK.disable if INSTALLED.length == 2
  end

  # Do not predeclare upstream namespaces: Zeitwerk would skip their real files.
  # Native Module#name avoids REXML's unrelated XPath .name function.
  LOAD_HOOK = TracePoint.new(:end) { |event| install(event.self) }
end

LabulubiusHtml2rssProfiles::LOAD_HOOK.enable
if defined?(Html2rss::Web::Feeds::SourceResolver)
  LabulubiusHtml2rssProfiles.install(Html2rss::Web::Feeds::SourceResolver)
end
if defined?(Html2rss::RequestService::BotasaurusStrategy)
  LabulubiusHtml2rssProfiles.install(Html2rss::RequestService::BotasaurusStrategy)
end
