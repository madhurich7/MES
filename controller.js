function parseStateRef(ref, current) {
  var preparsed = ref.match(/^\s*({[^}]*})\s*$/), parsed;
  if (preparsed) ref = current + '(' + preparsed[1] + ')';
  parsed = ref.replace(/\n/g, " ").match(/^([^(]+?)\s*(\((.*)\))?$/);
  if (!parsed || parsed.length !== 4) throw new Error("Invalid state ref '" + ref + "'");
  return { state: parsed[1], paramExpr: parsed[3] || null };
}

function stateContext(el) {
  var stateData = el.parent().inheritedData('$uiView');

  if (stateData && stateData.state && stateData.state.name) {
    return stateData.state;
  }
}

function getTypeInfo(el) {
  // SVGAElement does not use the href attribute, but rather the 'xlinkHref' attribute.
  var isSvg = Object.prototype.toString.call(el.prop('href')) === '[object SVGAnimatedString]';
  var isForm = el[0].nodeName === "FORM";

  return {
    attr: isForm ? "action" : (isSvg ? 'xlink:href' : 'href'),
    isAnchor: el.prop("tagName").toUpperCase() === "A",
    clickable: !isForm
  };
}

function clickHook(el, $state, $timeout, type, current) {
  return function(e) {
    var button = e.which || e.button, target = current();

    if (!(button > 1 || e.ctrlKey || e.metaKey || e.shiftKey || el.attr('target'))) {
      // HACK: This is to allow ng-clicks to be processed before the transition is initiated:
      var transition = $timeout(function() {
        $state.go(target.state, target.params, target.options);
      });
      e.preventDefault();

      // if the state has no URL, ignore one preventDefault from the <a> directive.
      var ignorePreventDefaultCount = type.isAnchor && !target.href ? 1: 0;

      e.preventDefault = function() {
        if (ignorePreventDefaultCount-- <= 0) $timeout.cancel(transition);
      };
    }
  };
}

function defaultOpts(el, $state) {
  return { relative: stateContext(el) || $state.$current, inherit: true };
}


$StateRefDirective.$inject = ['$state', '$timeout'];
function $StateRefDirective($state, $timeout) {
  return {
    restrict: 'A',
    require: ['?^uiSrefActive', '?^uiSrefActiveEq'],
    link: function(scope, element, attrs, uiSrefActive) {
      var ref    = parseStateRef(attrs.uiSref, $state.current.name);
      var def    = { state: ref.state, href: null, params: null };
      var type   = getTypeInfo(element);
      var active = uiSrefActive[1] || uiSrefActive[0];

      def.options = extend(defaultOpts(element, $state), attrs.uiSrefOpts ? scope.$eval(attrs.uiSrefOpts) : {});

      var update = function(val) {
        if (val) def.params = angular.copy(val);
        def.href = $state.href(ref.state, def.params, def.options);

        if (active) active.$$addStateInfo(ref.state, def.params);
        if (def.href !== null) attrs.$set(type.attr, def.href);
      };

      if (ref.paramExpr) {
        scope.$watch(ref.paramExpr, function(val) { if (val !== def.params) update(val); }, true);
        def.params = angular.copy(scope.$eval(ref.paramExpr));
      }
      update();

      if (!type.clickable) return;
      element.bind("click", clickHook(element, $state, $timeout, type, function() { return def; }));
    }
  };
}


$StateRefDynamicDirective.$inject = ['$state', '$timeout'];
function $StateRefDynamicDirective($state, $timeout) {
  return {
    restrict: 'A',
    require: ['?^uiSrefActive', '?^uiSrefActiveEq'],
    link: function(scope, element, attrs, uiSrefActive) {
      var type   = getTypeInfo(element);
      var active = uiSrefActive[1] || uiSrefActive[0];
      var group  = [attrs.uiState, attrs.uiStateParams || null, attrs.uiStateOpts || null];
      var watch  = '[' + group.map(function(val) { return val || 'null'; }).join(', ') + ']';
      var def    = { state: null, params: null, options: null, href: null };

      function runStateRefLink (group) {
        def.state = group[0]; def.params = group[1]; def.options = group[2];
        def.href = $state.href(def.state, def.params, def.options);

        if (active) active.$$addStateInfo(def.state, def.params);
        if (def.href) attrs.$set(type.attr, def.href);
      }

      scope.$watch(watch, runStateRefLink, true);
      runStateRefLink(scope.$eval(watch));

      if (!type.clickable) return;
      element.bind("click", clickHook(element, $state, $timeout, type, function() { return def; }));
    }
  };
}



$StateRefActiveDirective.$inject = ['$state', '$stateParams', '$interpolate'];
function $StateRefActiveDirective($state, $stateParams, $interpolate) {
  return  {
    restrict: "A",
    controller: ['$scope', '$element', '$attrs', '$timeout', function ($scope, $element, $attrs, $timeout) {
      var states = [], activeClasses = {}, activeEqClass, uiSrefActive;

      // There probably isn't much point in $observing this
      // uiSrefActive and uiSrefActiveEq share the same directive object with some
      // slight difference in logic routing
      activeEqClass = $interpolate($attrs.uiSrefActiveEq || '', false)($scope);

      try {
        uiSrefActive = $scope.$eval($attrs.uiSrefActive);
      } catch (e) {
        // Do nothing. uiSrefActive is not a valid expression.
        // Fall back to using $interpolate below
      }
      uiSrefActive = uiSrefActive || $interpolate($attrs.uiSrefActive || '', false)($scope);
      if (isObject(uiSrefActive)) {
        forEach(uiSrefActive, function(stateOrName, activeClass) {
          if (isString(stateOrName)) {
            var ref = parseStateRef(stateOrName, $state.current.name);
            addState(ref.state, $scope.$eval(ref.paramExpr), activeClass);
          }
        });
      }

      // Allow uiSref to communicate with uiSrefActive[Equals]
      this.$$addStateInfo = function (newState, newParams) {
        // we already got an explicit state provided by ui-sref-active, so we
        // shadow the one that comes from ui-sref
        if (isObject(uiSrefActive) && states.length > 0) {
          return;
        }
        addState(newState, newParams, uiSrefActive);
        update();
      };

      $scope.$on('$stateChangeSuccess', update);

      function addState(stateName, stateParams, activeClass) {
        var state = $state.get(stateName, stateContext($element));
        var stateHash = createStateHash(stateName, stateParams);

        states.push({
          state: state || { name: stateName },
          params: stateParams,
          hash: stateHash
        });

        activeClasses[stateHash] = activeClass;
      }

      /**
       * @param {string} state
       * @param {Object|string} [params]
       * @return {string}
       */
      function createStateHash(state, params) {
        if (!isString(state)) {
          throw new Error('state should be a string');
        }
        if (isObject(params)) {
          return state + toJson(params);
        }
        params = $scope.$eval(params);
        if (isObject(params)) {
          return state + toJson(params);
        }
        return state;
      }

      // Update route state
      function update() {
        for (var i = 0; i < states.length; i++) {
          if (anyMatch(states[i].state, states[i].params)) {
            addClass($element, activeClasses[states[i].hash]);
          } else {
            removeClass($element, activeClasses[states[i].hash]);
          }

          if (exactMatch(states[i].state, states[i].params)) {
            addClass($element, activeEqClass);
          } else {
            removeClass($element, activeEqClass);
          }
        }
      }

      function addClass(el, className) { $timeout(function () { el.addClass(className); }); }
      function removeClass(el, className) { el.removeClass(className); }
      function anyMatch(state, params) { return $state.includes(state.name, params); }
      function exactMatch(state, params) { return $state.is(state.name, params); }

      update();
    }]
  };
}

angular.module('ui.router.state')
  .directive('uiSref', $StateRefDirective)
  .directive('uiSrefActive', $StateRefActiveDirective)
  .directive('uiSrefActiveEq', $StateRefActiveDirective)
  .directive('uiState', $StateRefDynamicDirective);
