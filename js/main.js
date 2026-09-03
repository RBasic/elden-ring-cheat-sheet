(function($) {

    var defaultProfiles = {
        'current': 'Default Profile'
    };
    defaultProfiles[profilesKey] = {
        'Default Profile': {
            checklistData: {}
        }
    }
    var profiles = $.jStorage.get(profilesKey, defaultProfiles);

    jQuery(document).ready(function($) {

        // TODO Find a better way to do this in one pass
        $('ul li li').each(function(index) {
            if ($(this).attr('data-id')) {
                addCheckbox(this);
            }
        });
        $('ul li').each(function(index) {
            if ($(this).attr('data-id')) {
                addCheckbox(this);
            }
        });

        populateProfiles();

        $('input[type="checkbox"]').click(function() {
            var id = $(this).attr('id');
            var isChecked = profiles[profilesKey][profiles.current].checklistData[id] = $(this).prop('checked');
            //_gaq.push(['_trackEvent', 'Checkbox', (isChecked ? 'Check' : 'Uncheck'), id]);
            $(this).parent().parent().find('li > label > input[type="checkbox"]').each(function() {
                var id = $(this).attr('id');
                profiles[profilesKey][profiles.current].checklistData[id] = isChecked;
                $(this).prop('checked', isChecked);
            });
            $.jStorage.set(profilesKey, profiles);
            calculateTotals();
        });

        $('#profiles').change(function(event) {
            profiles.current = $(this).val();
            $.jStorage.set(profilesKey, profiles);
            populateChecklists();
            //_gaq.push(['_trackEvent', 'Profile', 'Change', profiles.current]);
        });

        $('#profileAdd').click(function() {
            $('#profileModalTitle').html('Add Profile');
            $('#profileModalName').val('');
            $('#profileModalAdd').show();
            $('#profileModalUpdate').hide();
            $('#profileModalDelete').hide();
            $('#profileModal').modal('show');
            //_gaq.push(['_trackEvent', 'Profile', 'Add']);
        });

        $('#profileEdit').click(function() {
            $('#profileModalTitle').html('Edit Profile');
            $('#profileModalName').val(profiles.current);
            $('#profileModalAdd').hide();
            $('#profileModalUpdate').show();
            if (canDelete()) {
                $('#profileModalDelete').show();
            } else {
                $('#profileModalDelete').hide();
            }
            $('#profileModal').modal('show');
            //_gaq.push(['_trackEvent', 'Profile', 'Edit', profiles.current]);
        });

        $('#profileModalAdd').click(function(event) {
            event.preventDefault();
            var profile = $.trim($('#profileModalName').val());
            if (profile.length > 0) {
                if (typeof profiles[profilesKey][profile] == 'undefined') {
                    profiles[profilesKey][profile] = { checklistData: {} };
                }
                profiles.current = profile;
                $.jStorage.set(profilesKey, profiles);
                populateProfiles();
                populateChecklists();
            }
            $('#profileModal').modal('hide');
            //_gaq.push(['_trackEvent', 'Profile', 'Create', profile]);
        });

        $('#profileModalUpdate').click(function(event) {
            event.preventDefault();
            var newName = $.trim($('#profileModalName').val());
            if (newName.length > 0 && newName != profiles.current) {
                profiles[profilesKey][newName] = profiles[profilesKey][profiles.current];
                delete profiles[profilesKey][profiles.current];
                profiles.current = newName;
                $.jStorage.set(profilesKey, profiles);
                populateProfiles();
            }
            $('#profileModal').modal('hide');
            //_gaq.push(['_trackEvent', 'Profile', 'Update', profile]);
        });

        $('#profileModalDelete').click(function(event) {
            event.preventDefault();
            if (!canDelete()) {
                return;
            }
            if (!confirm('Are you sure?')) {
                return;
            }
            delete profiles[profilesKey][profiles.current];
            profiles.current = getFirstProfile();
            $.jStorage.set(profilesKey, profiles);
            populateProfiles();
            populateChecklists();
            $('#profileModal').modal('hide');
            //_gaq.push(['_trackEvent', 'Profile', 'Delete']);
        });

        $('#profileModalClose').click(function(event) {
            event.preventDefault();
            $('#profileModal').modal('hide');
            //_gaq.push(['_trackEvent', 'Profile', 'Close']);
        });

        calculateTotals();

    });

    function populateProfiles() {
        $('#profiles').empty();
        $.each(profiles[profilesKey], function(index, value) {
            $('#profiles').append($("<option></option>").attr('value', index).text(index));
        });
        $('#profiles').val(profiles.current);
    }

    function populateChecklists() {
        $('input[type="checkbox"]').prop('checked', false);
        $.each(profiles[profilesKey][profiles.current].checklistData, function(index, value) {
            $('#' + index).prop('checked', value);
        });
        calculateTotals();
    }

    function calculateTotals() {
        $('[id$="_overall_total"]').each(function(index) {
            var type = this.id.match(/(.*)_overall_total/)[1];
            var overallCount = 0, overallChecked = 0;
            $('[id^="' + type + '_totals_"]').each(function(index) {
                var regex = new RegExp(type + '_totals_(.*)');
                var i = parseInt(this.id.match(regex)[1]);
                var count = 0, checked = 0, countedGroups = {};
                for (var j = 1; ; j++) {
                    var checkbox = $('#' + type + '_' + i + '_' + j);
                    if (checkbox.length == 0) {
                        break;
                    }
                    var li = checkbox.closest('li');
                    if (li.hasClass('choice-head')) {
                        continue;   // a "pick one of the following" label, not a task
                    }
                    var grp = li.attr('data-choice-group');
                    if (grp) {
                        if (countedGroups[grp]) { continue; }   // one exclusive group counts once
                        countedGroups[grp] = true;
                        count++;
                        overallCount++;
                        if ($('li[data-choice-group="' + grp + '"] input[type="checkbox"]:checked').length) {
                            checked++;
                            overallChecked++;
                        }
                        continue;
                    }
                    count++;
                    overallCount++;
                    if (checkbox.prop('checked')) {
                        checked++;
                        overallChecked++;
                    }
                }
                var pct, headerLabel, navLabel, addCls, removeCls;
                if (count == 0) {
                    headerLabel = navLabel = ''; addCls = ''; removeCls = 'done in_progress';
                } else if (checked == count) {
                    headerLabel = navLabel = 'DONE'; addCls = 'done'; removeCls = 'in_progress';
                } else {
                    pct = Math.round((checked / count) * 100) + '%';
                    navLabel = pct;
                    headerLabel = checked + ' / ' + count + ' · ' + pct;
                    addCls = 'in_progress'; removeCls = 'done';
                }
                this.innerHTML = headerLabel;
                $(this).removeClass(removeCls).addClass(addCls);
                var navEl = $('#' + type + '_nav_totals_' + i)[0];
                if (navEl) {
                    navEl.innerHTML = navLabel;
                    $(navEl).removeClass(removeCls).addClass(addCls);
                }
            });
            this.setAttribute('data-checked', overallChecked);
            this.setAttribute('data-count', overallCount);
            if (overallCount > 0 && overallChecked == overallCount) {
                this.innerHTML = 'DONE';
                $(this).removeClass('in_progress').addClass('done');
            } else {
                this.innerHTML = overallCount ? Math.round((overallChecked / overallCount) * 100) + '%' : '';
                $(this).removeClass('done').addClass('in_progress');
            }
        });
    }

    function addCheckbox(el) {
        var lines = $(el).html().split('\n');
        lines[0] = '<label class="checkbox"><input type="checkbox" id="' + $(el).attr('data-id') + '">' + lines[0] + '</label>';
        $(el).html(lines.join('\n'));
        if (profiles[profilesKey][profiles.current].checklistData[$(el).attr('data-id')] == true) {
            $('#' + $(el).attr('data-id')).prop('checked', true);
        }
    }

    function canDelete() {
        var count = 0;
        $.each(profiles[profilesKey], function(index, value) {
            count++;
        });
        return (count > 1);
    }

    function getFirstProfile() {
        for (var profile in profiles[profilesKey]) {
            return profile;
        }
    }

})( jQuery );