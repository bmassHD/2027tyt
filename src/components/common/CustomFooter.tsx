import React from 'react';
import {
  Phone,
  Mail,
  MapPin,
  Clock,
  ExternalLink,
  Globe,
  Code2,
  User,
} from 'lucide-react';
import { SystemSettings } from '../../types';
import { StationLogo } from './StationLogo';
import { hasSoftwareTeamContactInfo } from './SoftwareTeamContactCard';
import { getConfiguredEmergencyContacts } from '../../services/firebaseService';
import { useVisitorStats } from '../../services/visitorStatsService';

interface CustomFooterProps {
  settings: SystemSettings;
  settingsLoaded?: boolean;
  onNavigateToView?: (view: string) => void;
}

export const CustomFooter: React.FC<CustomFooterProps> = ({ settings, settingsLoaded = true }) => {
  const visitorStats = useVisitorStats();
  const isConfigured = settings.stationName && !settings.stationName.includes('Chưa cấu hình');
  const linksToDisplay = settings.quickLinks || [];
  const social = settings.socialLinks || {};
  const hasSocialLinks = Boolean(
    social.facebook?.trim() || social.zalo?.trim() || social.tiktok?.trim() || social.youtube?.trim()
  );
  const hasHotline = Boolean(settings.hotline && !settings.hotline.includes('Chưa cập nhật'));

  const stationDisplayName = isConfigured ? settings.stationName : 'Trạm Y Tế';
  const directorRaw =
    settings.orgChart?.director?.fullName?.trim() ||
    (settings.leaderName && !settings.leaderName.includes('Chưa cập nhật')
      ? settings.leaderName.trim()
      : '');
  const editorialBoardText = settings.editorialBoard?.trim() || stationDisplayName;
  const responsiblePersonText =
    settings.responsiblePerson?.trim() ||
    (directorRaw
      ? directorRaw.toLowerCase().includes('giám đốc')
        ? directorRaw
        : `Giám đốc ${directorRaw}`
      : 'Giám đốc Trạm Y Tế');
  const rawCopyright = settings.copyrightText?.trim();
  const copyrightDisplay = rawCopyright
    ? rawCopyright.toLowerCase().includes('bản quyền') || rawCopyright.includes('©')
      ? rawCopyright
      : `© ${new Date().getFullYear()} Bản quyền thuộc về ${rawCopyright}`
    : `© ${new Date().getFullYear()} Bản quyền thuộc về ${stationDisplayName}`;

  const softTeam = settings.softwareTeamContact;
  const showSoftwareTeam = hasSoftwareTeamContactInfo(softTeam);

  return (
    <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">
      {/* Upper Main Footer Grid */}
      <div className="w-full px-4 sm:px-8 py-10">
        <div
          className={`grid grid-cols-1 md:grid-cols-2 ${
            showSoftwareTeam ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
          } gap-8`}
        >
          {/* Col 1: Brand & Social Channels */}
          <div className="space-y-3.5 lg:col-span-1">
            {!settingsLoaded ? (
              <div className="space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-slate-200 dark:bg-slate-800 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 w-36 bg-slate-200 dark:bg-slate-800 rounded" />
                    <div className="h-4 w-48 bg-slate-200 dark:bg-slate-800 rounded" />
                  </div>
                </div>
                <div className="h-3.5 w-full bg-slate-100 dark:bg-slate-800 rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <StationLogo size={46} />
                  <div>
                    <span className="text-xs font-bold tracking-wider text-emerald-700 dark:text-emerald-400 uppercase block">
                      {settings.parentUnitName || 'TRUNG TÂM Y TẾ QUẬN / HUYỆN'}
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900 dark:text-white leading-tight">
                      {isConfigured ? settings.stationName : 'TRẠM Y TẾ XÃ/PHƯỜNG'}
                    </h3>
                  </div>
                </div>

                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {settings.subTitle ||
                    'Hệ thống y tế cơ sở chăm sóc sức khỏe ban đầu và phòng chống dịch bệnh.'}
                </p>

                {hasSocialLinks && (
                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    {social.facebook?.trim() && (
                      <a
                        href={social.facebook.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 text-xs font-bold transition"
                      >
                        Facebook
                      </a>
                    )}
                    {social.zalo?.trim() && (
                      <a
                        href={social.zalo.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 text-xs font-bold transition"
                      >
                        Zalo
                      </a>
                    )}
                    {social.tiktok?.trim() && (
                      <a
                        href={social.tiktok.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 text-xs font-bold transition"
                      >
                        TikTok
                      </a>
                    )}
                    {social.youtube?.trim() && (
                      <a
                        href={social.youtube.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 text-xs font-bold transition"
                      >
                        YouTube
                      </a>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Col 2: Device-Paired Contact Information */}
          <div className="space-y-3 text-sm">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2">
              Thông Tin Liên Hệ &amp; Trực Ban
            </h4>

            {!settingsLoaded ? (
              <div className="space-y-2.5 animate-pulse">
                <div className="h-4 w-full bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-800 rounded" />
              </div>
            ) : (
              <ul className="space-y-2.5 text-slate-600 dark:text-slate-400">
                <li className="flex items-start gap-2.5">
                  <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{settings.address || 'Địa chỉ đang cập nhật'}</span>
                </li>

                {getConfiguredEmergencyContacts(settings).map(ec => (
                  <li key={ec.id} className="flex items-start gap-2.5">
                    <Phone className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <div>
                        <span className="text-slate-500">Cấp cứu 24/7: </span>
                        <a
                          href={`tel:${ec.phone}`}
                          className="font-bold text-rose-600 hover:underline tabular-nums"
                        >
                          {ec.phone}
                        </a>
                      </div>
                      {ec.note && (
                        <p className="text-xs text-rose-600/90 dark:text-rose-400 mt-0.5">
                          {ec.note}
                        </p>
                      )}
                    </div>
                  </li>
                ))}

                <li className="flex items-center gap-2.5">
                  <Phone className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div>
                    <span className="text-slate-500">Hotline: </span>
                    {hasHotline ? (
                      <a
                        href={`tel:${settings.hotline}`}
                        className="font-bold text-slate-900 dark:text-white hover:text-emerald-600 hover:underline tabular-nums"
                      >
                        {settings.hotline}
                      </a>
                    ) : (
                      <strong className="text-slate-900 dark:text-white">Chưa cập nhật</strong>
                    )}
                  </div>
                </li>

                <li className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-teal-600 shrink-0" />
                  {settings.email?.trim() ? (
                    <a
                      href={`mailto:${settings.email.trim()}`}
                      className="text-slate-800 dark:text-slate-200 font-semibold hover:text-emerald-600 hover:underline break-all"
                    >
                      {settings.email.trim()}
                    </a>
                  ) : (
                    <span className="text-slate-400">Chưa thiết lập Gmail</span>
                  )}
                </li>

                <li className="flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                  <span>{settings.workingHours || '7:30 - 17:00 (Trực cấp cứu 24/7)'}</span>
                </li>
              </ul>
            )}
          </div>

          {/* Col 3: Quick Access Links */}
          <div className="space-y-3 text-sm">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center justify-between">
              <span>Liên Kết Nhanh</span>
              <Globe className="w-4 h-4 text-emerald-600" />
            </h4>

            {!settingsLoaded ? (
              <div className="space-y-2.5 animate-pulse">
                <div className="h-8 w-full bg-slate-100 dark:bg-slate-800 rounded-xl" />
                <div className="h-8 w-full bg-slate-100 dark:bg-slate-800 rounded-xl" />
              </div>
            ) : linksToDisplay.length === 0 ? (
              <p className="text-xs text-slate-400 italic">
                Chưa có liên kết ngoài nào được thêm.
              </p>
            ) : (
              <ul className="space-y-2">
                {linksToDisplay.map(link => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start justify-between p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                    >
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 flex items-center gap-1.5 transition">
                          {link.title}
                          <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                        </span>
                        {link.description && (
                          <p className="text-xs text-slate-400 mt-0.5">{link.description}</p>
                        )}
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Col 4: Software Team & Technical Support Contact (when configured) */}
          {showSoftwareTeam && softTeam && (
            <div className="space-y-3 text-sm">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2 flex items-center justify-between">
                <span>Đội Ngũ Phần Mềm</span>
                <Code2 className="w-4 h-4 text-sky-600" />
              </h4>

              <ul className="space-y-2.5 text-slate-600 dark:text-slate-400">
                {(softTeam.teamName?.trim() || softTeam.roleLabel?.trim()) && (
                  <li>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {softTeam.teamName?.trim() || 'Đội ngũ Kỹ thuật & Phần mềm'}
                    </div>
                    {softTeam.roleLabel?.trim() && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {softTeam.roleLabel.trim()}
                      </p>
                    )}
                  </li>
                )}

                {softTeam.personName?.trim() && (
                  <li className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-sky-600 shrink-0" />
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {softTeam.personName.trim()}
                    </span>
                  </li>
                )}

                {softTeam.phone?.trim() && (
                  <li className="flex items-center gap-2.5">
                    <Phone className="w-4 h-4 text-sky-600 shrink-0" />
                    <a
                      href={`tel:${softTeam.phone.trim().replace(/\s+/g, '')}`}
                      className="font-bold text-slate-900 dark:text-white hover:text-sky-600 hover:underline tabular-nums"
                    >
                      {softTeam.phone.trim()}
                    </a>
                  </li>
                )}

                {softTeam.email?.trim() && (
                  <li className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-sky-600 shrink-0" />
                    <a
                      href={`mailto:${softTeam.email.trim()}`}
                      className="text-slate-800 dark:text-slate-200 font-semibold hover:text-sky-600 hover:underline break-all"
                    >
                      {softTeam.email.trim()}
                    </a>
                  </li>
                )}

                {softTeam.supportHours?.trim() && (
                  <li className="flex items-start gap-2.5">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    <span className="text-xs">{softTeam.supportHours.trim()}</span>
                  </li>
                )}

                {softTeam.note?.trim() && (
                  <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {softTeam.note.trim()}
                  </li>
                )}

                {(softTeam.zaloUrl?.trim() || softTeam.facebookUrl?.trim() || softTeam.websiteUrl?.trim()) && (
                  <li className="pt-1 flex flex-wrap items-center gap-2">
                    {softTeam.zaloUrl?.trim() && (
                      <a
                        href={softTeam.zaloUrl.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 text-xs font-bold transition"
                      >
                        Zalo
                      </a>
                    )}
                    {softTeam.facebookUrl?.trim() && (
                      <a
                        href={softTeam.facebookUrl.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 text-xs font-bold transition"
                      >
                        Facebook
                      </a>
                    )}
                    {softTeam.websiteUrl?.trim() && (
                      <a
                        href={softTeam.websiteUrl.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 text-xs font-bold transition"
                      >
                        Website
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Bar: Editorial Board, Responsibility, Copyright & Visitor Stats */}
      <div className="border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 py-4 px-4 sm:px-8 text-xs text-slate-500">
        <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="space-y-1 text-center lg:text-left leading-relaxed">
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-2.5 gap-y-0.5 text-slate-600 dark:text-slate-300">
              <span>
                <strong className="font-semibold text-slate-800 dark:text-slate-100">Ban biên tập:</strong>{' '}
                {editorialBoardText}
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">|</span>
              <span>
                <strong className="font-semibold text-slate-800 dark:text-slate-100">Chịu trách nhiệm:</strong>{' '}
                {responsiblePersonText}
              </span>
            </div>
            <div className="text-[11.5px] font-medium text-slate-500 dark:text-slate-400">
              {copyrightDisplay}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center lg:justify-end gap-x-4 gap-y-1.5 tabular-nums shrink-0">
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              Đang online: <strong>{visitorStats.onlineCount.toLocaleString('vi-VN')}</strong>
            </span>

            {visitorStats.loading ? (
              <span className="h-3 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse inline-block" />
            ) : (
              <>
                <span className="text-slate-600 dark:text-slate-400">
                  Hôm nay: <strong className="text-slate-900 dark:text-slate-200">{visitorStats.todayCount.toLocaleString('vi-VN')}</strong>
                </span>
                <span className="text-slate-600 dark:text-slate-400">
                  Tháng: <strong className="text-slate-900 dark:text-slate-200">{visitorStats.monthCount.toLocaleString('vi-VN')}</strong>
                </span>
                <span className="text-slate-600 dark:text-slate-400">
                  Tổng truy cập: <strong className="text-emerald-700 dark:text-emerald-400">{visitorStats.totalCount.toLocaleString('vi-VN')}</strong>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
};
