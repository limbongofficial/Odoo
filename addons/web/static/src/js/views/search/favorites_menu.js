odoo.define('web.FavoriteMenu', function (require) {
"use strict";

var config = require('web.config');
var core = require('web.core');
var data_manager = require('web.data_manager');
var pyeval = require('web.pyeval');
var session = require('web.session');
var Widget = require('web.Widget');

var _t = core._t;

return Widget.extend({
    template: 'SearchView.FavoriteMenu',
    events: {
        'click li': function (event) {
            event.stopImmediatePropagation();
        },
        'click li a': function (event) {
            event.preventDefault();
        },
        'click .o_save_search a': function (event) {
            event.preventDefault();
            this.toggle_save_menu();
        },
        'click .o_save_name button': 'save_favorite',
        'hidden.bs.dropdown': '_closeMenus',
        'keyup .o_save_name input': function (ev) {
            if (ev.which === $.ui.keyCode.ENTER) {
                this.save_favorite();
            }
        },
    },
    init: function (parent, query, target_model, action, filters) {
        this._super.apply(this,arguments);
        this.searchview = parent;
        this.query = query;
        this.target_model = target_model;
        this.action = action;
        this.action_id = action.id;
        this.filters = {};
        this.isMobile = config.device.isMobile;
        _.each(filters, this.add_filter.bind(this));
    },
    start: function () {
        var self = this;
        this.$filters = {};
        this.$save_search = this.$('.o_save_search');
        this.$save_name = this.$('.o_save_name');
        this.$inputs = this.$save_name.find('input');
        this.$user_divider = this.$('.divider.user_filter');
        this.$shared_divider = this.$('.divider.shared_filter');
        this.$inputs.eq(0).val(this.searchview.get_title());
        var $shared_filter = this.$inputs.eq(1),
            $default_filter = this.$inputs.eq(2);
        $shared_filter.click(function () {$default_filter.prop('checked', false);});
        $default_filter.click(function () {$shared_filter.prop('checked', false);});

        this.query
            .on('remove', function (facet) {
                if (facet.get('is_custom_filter')) {
                    self.clear_selection();
                }
            })
            .on('reset', this.proxy('clear_selection'));

        _.each(this.filters, this.append_filter.bind(this));

        return this._super();
    },
    toggle_save_menu: function (is_open) {
        this.$save_search
            .toggleClass('o_closed_menu', !(_.isUndefined(is_open)) ? !is_open : undefined)
            .toggleClass('o_open_menu', is_open);
        this.$save_name.toggle(is_open);
        if (this.$save_search.hasClass('o_open_menu')) {
            this.$save_name.find('input').first().focus();
        }
    },
    _closeMenus: function () {
        this.toggle_save_menu(false);
    },
    save_favorite: function () {
        var self = this,
            filter_name = this.$inputs[0].value,
            default_filter = this.$inputs[1].checked,
            shared_filter = this.$inputs[2].checked;
        if (!filter_name.length){
            this.do_warn(_t("Error"), _t("Filter name is required."));
            this.$inputs.first().focus();
            return;
        }
        if (_.chain(this.filters)
                .pluck('name')
                .contains(filter_name).value()) {
            this.do_warn(_t("Error"), _t("Filter with same name already exists."));
            this.$inputs.first().focus();
            return;
        }
        var user_context = this.getSession().user_context;
        var search = this.searchview.build_search_data();
        var controllerContext;
        this.trigger_up('get_controller_context', {
            callback: function (ctx) {
                controllerContext = ctx;
            },
        });
        var results = pyeval.eval_domains_and_contexts({
                domains: search.domains,
                contexts: [user_context].concat(search.contexts.concat(controllerContext || [])),
                group_by_seq: search.groupbys || [],
            });
        if (!_.isEmpty(results.group_by)) {
            results.context.group_by = results.group_by;
        }
        // Don't save user_context keys in the custom filter, otherwise end
        // up with e.g. wrong uid or lang stored *and used in subsequent
        // reqs*
        var ctx = results.context;
        _(_.keys(session.user_context)).each(function (key) {
            delete ctx[key];
        });
        var filter = {
            name: filter_name,
            user_id: shared_filter ? false : session.uid,
            model_id: this.target_model,
            context: results.context,
            domain: results.domain,
            sort: JSON.stringify(this.searchview.dataset._sort),
            is_default: default_filter,
            action_id: this.action_id,
        };
        return this._createFilter(filter).then(function (id) {
            filter.id = id;
            self.toggle_save_menu(false);
            self.$save_name.find('input').val('').prop('checked', false);
            self.add_filter(filter);
            self.append_filter(filter);
            self.toggle_filter(filter, true);
        });
    },
    get_default_filter: function () {
        var personal_filter = _.find(this.filters, function (filter) {
            return filter.user_id && filter.is_default;
        });
        if (personal_filter) {
            return personal_filter;
        }
        return _.find(this.filters, function (filter) {
            return !filter.user_id && filter.is_default;
        });
    },
    /**
     * Generates a mapping key (in the filters and $filter mappings) for the
     * filter descriptor object provided (as returned by ``get_filters``).
     *
     * The mapping key is guaranteed to be unique for a given (user_id, name)
     * pair.
     *
     * @param {Object} filter
     * @param {String} filter.name
     * @param {Number|Pair<Number, String>} [filter.user_id]
     * @return {String} mapping key corresponding to the filter
     */
    key_for: function (filter) {
        var user_id = filter.user_id,
            action_id = filter.action_id,
            uid = (user_id instanceof Array) ? user_id[0] : user_id,
            act_id = (action_id instanceof Array) ? action_id[0] : action_id;
        return _.str.sprintf('(%s)(%s)%s', uid, act_id, filter.name);
    },
    /**
     * Generates a :js:class:`~instance.web.search.Facet` descriptor from a
     * filter descriptor
     *
     * @param {Object} filter
     * @param {String} filter.name
     * @param {Object} [filter.context]
     * @param {Array} [filter.domain]
     * @return {Object}
     */
    facet_for: function (filter) {
        return {
            category: _t("Custom Filter"),
            icon: 'fa-star',
            field: {
                get_context: function () { return filter.context; },
                get_groupby: function () { return [filter.context]; },
                get_domain: function () { return filter.domain; }
            },
            _id: filter.id,
            is_custom_filter: true,
            values: [{label: filter.name, value: null}]
        };
    },
    clear_selection: function () {
        this.$('li.selected').removeClass('selected');
    },
    /**
     * Adds a filter description to the filters dict
     * @param {Object} [filter] the filter description
     */
    add_filter: function (filter) {
        this.filters[this.key_for(filter)] = filter;
    },
    /**
     * Creates a $filter JQuery node, adds it to the $filters dict and appends it to the filter menu
     * @param {Object} [filter] the filter description
     */
    append_filter: function (filter) {
        var self = this;
        var key = this.key_for(filter);

        if (filter.user_id) {
            this.$user_divider.show();
        } else {
            this.$shared_divider.show();
        }
        if (!(key in this.$filters)) {
            var $filter = $('<li>')
                .addClass(filter.user_id ? 'o-searchview-custom-private'
                                         : 'o-searchview-custom-public')
                .append($('<a>', {'href': '#'}).text(filter.name))
                .append($('<span>', {
                    class: 'fa fa-trash-o o-remove-filter',
                    on: {
                        click: function (event) {
                            event.stopImmediatePropagation();
                            self.remove_filter(filter, $filter, key);
                        },
                    },
                }))
                .insertBefore(filter.user_id ? this.$user_divider : this.$shared_divider);
            this.$filters[key] = $filter;
        }
        this.$filters[key].unbind('click').click(function () {
            self.toggle_filter(filter);
        });
    },
    toggle_filter: function (filter, preventSearch) {
        var current = this.query.find(function (facet) {
            return facet.get('_id') === filter.id;
        });
        if (current) {
            this.query.remove(current);
            this.$filters[this.key_for(filter)].removeClass('selected');
            return;
        }
        this.query.reset([this.facet_for(filter)], {
            preventSearch: preventSearch || false});

        // Load sort settings on view
        if (!_.isUndefined(filter.sort)){
            var sort_items = JSON.parse(filter.sort);
            this.searchview.dataset.set_sort(sort_items);
        }

        this.$filters[this.key_for(filter)].addClass('selected');
    },
    remove_filter: function (filter, $filter, key) {
        var self = this;
        var global_warning = _t("This filter is global and will be removed for everybody if you continue."),
            warning = _t("Are you sure that you want to remove this filter?");
        if (!confirm(filter.user_id ? warning : global_warning)) {
            return;
        }
        return data_manager
            .delete_filter(filter)
            .done(function () {
                $filter.remove();
                delete self.$filters[key];
                delete self.filters[key];
                var has_user_filter = _.find(self.filters, function(filter) { return filter.user_id; });
                var has_shared_filer = _.find(self.filters, function(filter) { return !filter.user_id; });
                if (!has_user_filter) {
                    self.$user_divider.hide();
                }
                if (!has_shared_filer) {
                    self.$shared_divider.hide();
                }
            });
    },

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Creates a new search view filter.
     *
     * @private
     * @param {Object} filter the filter description
     * @returns {$.Deferred} resolved with the RPC's result when it succeeds
     */
    _createFilter: function (filter) {
        var def = $.Deferred();
        this.trigger_up('create_filter', {
            filter: filter,
            on_success: def.resolve.bind(def),
        });
        return def;
    },
});

});
