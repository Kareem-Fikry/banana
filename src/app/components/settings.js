define(['underscore'],
function (_) {
  "use strict";

  return function Settings (options) {
    /**
     * To add a setting, you MUST define a default. Also,
     * THESE ARE ONLY DEFAULTS.
     * They are overridden by config.js in the root directory
     * @type {Object}
     */
    var defaults = {
      solr: "http://"+window.location.hostname+":8983/solr/",
      solr_core: "logstash_logs",
      banana_index  : 'banana-int',
      hive_webhcat_server: "http://"+window.location.hostname+":50111",
      hive_webhcat_user:   "hue",
      webhdfs_namenode_server: "http://"+window.location.hostname+":50070",
      USE_ADMIN_LUKE: true,
      USE_ADMIN_CORES: true,
      panel_names   : [],
    };

    // This initializes a new hash on purpose, to avoid adding parameters to
    // config.js without providing sane defaults
    var settings = {};
    _.each(defaults, function(value, key) {
      settings[key] = typeof options[key] !== 'undefined' ? options[key]  : defaults[key];
    });

    return settings;
  };
});
