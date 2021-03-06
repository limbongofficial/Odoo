odoo.define('mail.AbstractThreadWindow', function (require) {
"use strict";

var ThreadWidget = require('mail.widget.Thread');

var config = require('web.config');
var core = require('web.core');
var Widget = require('web.Widget');

var QWeb = core.qweb;
var _t = core._t;

var HEIGHT_OPEN = '400px';
var HEIGHT_FOLDED = '34px';

/**
 * This is an abstract widget for rendering thread windows.
 *
 * It contains logic that are shared between mail.ThreadWindow and
 * mail.LivechatWindow.
 *
 * The reason for having two different implementation of thread windows is
 * that mail.ThreadWindow makes use of mail.Manager, which is used in the
 * backend, while mail.LivechatWindow must work without this mail service.
 */
var AbstractThreadWindow = Widget.extend({
    template: 'mail.AbstractThreadWindow',
    custom_events: {
        escape_pressed: '_onEscapePressed',
        document_viewer_closed: '_onDocumentViewerClose',
    },
    events: {
        'click .o_thread_window_close': '_onClickClose',
        'click .o_thread_window_title': '_onClickFold',
        'click .o_thread_composer': '_onComposerClick',
        'click .o_mail_thread': '_onThreadWindowClicked',
        'keydown .o_thread_composer': '_onKeydown',
        'keypress .o_thread_composer': '_onKeypress',
    },
    /**
     * Children of this class must make use of `thread`, which is an object that
     * represent the thread that is linked to this thread window.
     *
     * If no thread is provided, this will represent the "blank" thread window.
     *
     * @abstract
     * @param {Widget} parent
     * @param {Object} thread
     * @param {Object} [options={}]
     */
    init: function (parent, thread, options) {
        this._super(parent);

        this.options = _.defaults(options || {}, {
            autofocus: true,
            displayStars: true,
            displayReplyIcons: false,
            displayEmailIcons: false,
            placeholder: _t("Say something"),
        });

        this._hidden = false;
    },
    start: function () {
        this.$input = this.$('.o_composer_text_field');
        this.$header = this.$('.o_thread_window_header');

        this.threadWidget = new ThreadWidget(this, {
            threadID: this._getThreadID(),
            displayDocumentLinks: false,
            displayMarkAsRead: false,
            displayStars: this.options.displayStars,
        });

        if (this.isFolded()) {
            this.$el.css('height', HEIGHT_FOLDED);
        } else if (this.options.autofocus) {
            this._focusInput();
        }
        if (!config.device.isMobile) {
            this.$el.css('margin-right', $.position.scrollbarWidth());
        }
        var def = this.threadWidget.replace(this.$('.o_chat_content'));
        return $.when(this._super(), def);
    },
    /**
     * @override
     */
    do_hide: function () {
        this._hidden = true;
        this._super.apply(this, arguments);
    },
    /**
     * @override
     */
    do_show: function () {
        this._hidden = false;
        this._super.apply(this, arguments);
    },
    /**
     * @override
     */
    do_toggle: function (display) {
        this._hidden = _.isBoolean(display) ? !display : !this._hidden;
        this._super.apply(this, arguments);
    },

    //--------------------------------------------------------------------------
    // Public
    //--------------------------------------------------------------------------

    /**
     * Close this window
     *
     * @abstract
     */
    close: function () {},
    /**
     * Get the status of the thread, such as the im status of a DM.
     *
     * @abstract
     * @returns {string}
     */
    getStatus: function () {},
    /**
     * Get the title of the thread window, which usually contains the name of
     * the thread.
     *
     * @abstract
     * @returns {string}
     */
    getTitle: function () {},
    /**
     * Get the unread counter of the thread linked to this thread window.
     *
     * @abstract
     * @returns {integer}
     */
    getUnreadCounter: function () {},
    /**
     * States whether this thread window is related to a thread or not.
     *
     * This is useful in order to provide specific behaviour for thread windows
     * without any thread, e.g. let them open a thread from this "blank" thread
     * window.
     *
     * @abstract
     * @returns {boolean}
     */
    hasThread: function () {},
    /**
     * States whether this thread is folded or not. This information is stored
     * on the thread model.
     *
     * @abstract
     * @returns {boolean}
     */
    isFolded: function () {},
    /**
     * States whether the current environment is in mobile or not. This is
     * useful in order to customize the template rendering for mobile view.
     *
     * @returns {boolean}
     */
    isMobile: function () {
        return config.device.isMobile;
    },
    /**
     * States whether the thread window is hidden or not.
     *
     * @returns {boolean}
     */
    isHidden: function () {
        return this._hidden;
    },
    /**
     * Render the thread window, using the provided list of messages
     *
     * TODO: use messages in thread, instead of providing list of messages
     *
     * @param {mail.model.AbstractMessage[]} messages
     */
    render: function (messages) {
        this._renderHeader();
        this.threadWidget.render(messages, { displayLoadMore: false });
    },
    /**
     * Toggle the fold state of this thread window. Also update the fold state
     * of the thread model.
     *
     * @param {boolean} folded
     */
    toggleFold: function (folded) {
        if (!_.isBoolean(folded)) {
            folded = !this.isFolded();
        }
        this._updateThreadFoldState(folded);
    },
    /**
     * Update the visual state of the window so that it matched the internal
     * fold state. This is useful in case the related thread has its fold state
     * that has been changed.
     */
    updateVisualFoldState: function () {
        if (!this.isFolded()) {
            this.threadWidget.scrollToBottom();
            this._focusInput();
        }
        this._animateFold();
    },

    //--------------------------------------------------------------------------
    // Private
    //--------------------------------------------------------------------------

    /**
     * Called when there is a change of the fold state of the thread window.
     * This method animates the change of fold state of this thread window.
     *
     * @private
     */
    _animateFold: function () {
        this.$el.animate({
            height: this.isFolded() ? HEIGHT_FOLDED : HEIGHT_OPEN
        }, 200);
    },
    /**
     * Set the focus on the composer of the thread window. This operation is
     * ignored in mobile context.
     *
     * @private
     * Set the focus on the input of the window
     */
    _focusInput: function () {
        if (
            config.device.touch &&
            config.device.size_class <= config.device.SIZES.SM
        ) {
            return;
        }
        this.$input.focus();
    },
    /**
     * Returns the options used by the rendering of the window's header
     *
     * @private
     * @returns {Object}
     */
    _getHeaderRenderingOptions: function () {
        return {
            status: this.getStatus(),
            title: this.getTitle(),
            unreadCounter: this.getUnreadCounter(),
            widget: this,
        };
    },
    /**
     * Get the ID of the related thread.
     *
     * @abstract
     * @private
     * @return {integer}
     */
    _getThreadID: function () {},
    /**
     * Post a message on this thread window
     *
     * @abstract
     * @private
     * @param {Object} messageData
     */
    _postMessage: function (messageData) {},
    /**
     * Update the fold state of the related thread.
     * This function is called when toggling the fold state of this window
     *
     * @abstract
     * @private
     * @param {boolean} folded
     */
    _updateThreadFoldState: function (folded) {},
    /**
     * Render the header of this thread window
     *
     * @private
     */
    _renderHeader: function () {
        var options = this._getHeaderRenderingOptions();
        this.$header.html(
            QWeb.render('mail.AbstractThreadWindowHeaderContent', options));
    },

    //--------------------------------------------------------------------------
    // Handlers
    //--------------------------------------------------------------------------

    /**
     * Close the thread
     *
     * @private
     * @param {MouseEvent} ev
     */
    _onClickClose: function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        this.close();
    },
    /**
     * Fold/unfold the thread window
     *
     * @private
     */
    _onClickFold: function () {
        if (!config.device.isMobile) {
            this.toggleFold();
        }
    },
    /**
     * Called when the composer is clicked -> forces focus on input even if
     * jquery's blockUI is enabled.
     *
     * @private
     * @param {Event} ev
     */
    _onComposerClick: function (ev) {
        if ($(ev.target).closest('a, button').length) {
            return;
        }
        this._focusInput();
    },
    /**
     * @private
     */
    _onDocumentViewerClose: function () {
        this._focusInput();
    },
    /**
     * @private
     */
    _onEscapePressed: function () {
        if (!this.isFolded()) {
            this.close();
        }
    },
    /**
     * Called when typing something on the composer of this thread window.
     *
     * @private
     * @param {KeyboardEvent} ev
     */
    _onKeydown: function (ev) {
        ev.stopPropagation(); // to prevent jquery's blockUI to cancel event
        // ENTER key (avoid requiring jquery ui for external livechat)
        if (ev.which === 13) {
            var content = _.str.trim(this.$input.val());
            var messageData = {
                content: content,
                attachment_ids: [],
                partner_ids: [],
            };
            this.$input.val('');
            if (content) {
                this._postMessage(messageData);
            }
        }
    },
    /**
     * @private
     * @param {KeyboardEvent} ev
     */
    _onKeypress: function (ev) {
        ev.stopPropagation(); // to prevent jquery's blockUI to cancel event
    },
    /**
     * When a thread window is clicked on, we want to give the focus to the main
     * input. An exception is made when the user is selecting something.
     *
     * @private
     */
    _onThreadWindowClicked: function () {
        var selectObj = window.getSelection();
        if (selectObj.anchorOffset === selectObj.focusOffset) {
            this.$input.focus();
        }
    },
});

return AbstractThreadWindow;

});
